/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSourceOpsCommand } from '../../src/cli/cmds/ops.js';
import { createProgram as createPackagedOperatorProgram } from '../../src/core/resources/builds/actor-system-cli/index.js';
import { createPackagedDurableWorkflowStartCommand } from '../../src/core/resources/builds/actor-system-cli/control_cmds/start.js';
import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
} from '../../src/core/resources/builds/lib/revision-runtime-assets.js';
import {
  WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
  WORKFLOW_PLAN_PAYLOAD_KIND,
  createWorkflowPlanId,
  createWorkflowRunId,
  normalizeWorkflowPlanPayload,
} from '../../src/core/lib/ledger/workflow-execution-contract.js';
import {
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
  createApplicationRevision,
} from '../../src/core/runtime/application-revision.js';
import { createDurableWorkflowStartCommand } from '../../src/core/runtime/operator/durable-workflow-start-command.js';

const sourceOpsCommand = createSourceOpsCommand();

/** @typedef {import('../../src/core/runtime/durable-activity-host.js').ManifestActivityExecution} ManifestActivityExecution */
/** @typedef {Extract<ManifestActivityExecution, {kind: 'embedded'}>} EmbeddedExecution */
/** @typedef {Extract<ManifestActivityExecution, {kind: 'prepared-source'}>} PreparedExecution */

const APP_ID = 'workflow-start-command-demo';
const WORKFLOW_ID = 'main';
const STEP_ID = 'greet-step';
const SOURCE_DIR = join(tmpdir(), 'wharfie-workflow-start-source');
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/** @param {string} value - Stable fixture digest input. */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/** @param {Record<string, any>[]} [steps] @returns {EmbeddedExecution} - Valid packaged execution fixture. */
function makeEmbeddedExecution(steps) {
  const contract = {
    schemaVersion: 3,
    app: { id: APP_ID },
    cli: {
      entrypoint: { kind: 'node', path: 'cli.js', export: 'main' },
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
        steps: steps || [
          {
            id: STEP_ID,
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

/**
 * @param {EmbeddedExecution} embedded - Matching packaged fixture.
 * @returns {PreparedExecution} - Valid prepared-source execution fixture.
 */
function makePreparedExecution(embedded) {
  return /** @type {PreparedExecution} */ ({
    kind: 'prepared-source',
    prepared: {
      revision: embedded.embeddedRevision.revision,
      appDir: SOURCE_DIR,
      manifest: structuredClone(embedded.manifest),
      assets: {},
      dependencyLock: {
        path: join(SOURCE_DIR, 'package-lock.json'),
        input: embedded.embeddedRevision.revision.inputs.dependencies,
      },
      verifyRuntime: async () => undefined,
      cleanup: async () => undefined,
    },
  });
}

/**
 * @param {ManifestActivityExecution} execution - Immutable execution fixture.
 * @returns {{appId: string, revisionId: string, manifest: Record<string, any>}} - Fixture identity.
 */
function executionIdentity(execution) {
  const revision =
    execution.kind === 'embedded'
      ? execution.embeddedRevision.revision
      : execution.prepared.revision;
  const manifest =
    execution.kind === 'embedded'
      ? execution.manifest
      : execution.prepared.manifest;
  return {
    appId: manifest.app.id,
    revisionId: revision.revisionId,
    manifest,
  };
}

/**
 * @param {ManifestActivityExecution} execution - Immutable execution fixture.
 * @param {string} idempotencyKey - Public request identity.
 * @param {boolean} [applied] - Whether the start was newly applied.
 * @returns {Record<string, any>} - Complete durable workflow start result.
 */
function makeStartResult(execution, idempotencyKey, applied = true) {
  const { appId, revisionId, manifest } = executionIdentity(execution);
  const planPayload = normalizeWorkflowPlanPayload({
    schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
    kind: WORKFLOW_PLAN_PAYLOAD_KIND,
    appId,
    revisionId,
    workflowId: WORKFLOW_ID,
    definition: manifest.workflows[WORKFLOW_ID],
  });
  const planId = createWorkflowPlanId(planPayload);
  const runId = createWorkflowRunId({ appId, idempotencyKey });
  const invocationId = 'workflow-start-invocation-1';
  const continuationId = 'workflow-start-continuation-1';
  return {
    appId,
    revisionId,
    workflowId: WORKFLOW_ID,
    idempotencyKey,
    runId,
    planId,
    outcome: {
      applied,
      run: {
        runId,
        appId,
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
        appId,
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
        appId,
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
 * @param {ManifestActivityExecution} execution - Immutable execution fixture.
 * @param {string} idempotencyKey - Public request identity.
 * @param {boolean} [reused] - Whether the result was replayed.
 * @returns {Record<string, any>} - Safe public output row.
 */
function expectedRow(execution, idempotencyKey, reused = false) {
  const { appId, revisionId } = executionIdentity(execution);
  return {
    idempotency_key: idempotencyKey,
    run_id: createWorkflowRunId({ appId, idempotencyKey }),
    revision: revisionId,
    workflow: WORKFLOW_ID,
    status: 'RUNNING',
    cursor_disposition: 'ACTIVITY_RUNNABLE',
    step: STEP_ID,
    step_index: 0,
    activation_kind: 'activity',
    activation_status: 'RUNNABLE',
    reused,
  };
}

/**
 * @param {ManifestActivityExecution} execution - Immutable execution fixture.
 * @param {string} idempotencyKey - Public request identity.
 * @param {boolean} [reused] - Whether the result was replayed.
 * @returns {Record<string, any>} - Versioned safe public receipt.
 */
function expectedReceipt(execution, idempotencyKey, reused = false) {
  const { appId, revisionId } = executionIdentity(execution);
  return {
    schemaVersion: 1,
    kind: 'wharfie.execution-ledger.workflow-start',
    appId,
    runId: createWorkflowRunId({ appId, idempotencyKey }),
    revisionId,
    workflowId: WORKFLOW_ID,
    idempotencyKey,
    reused,
    runStatus: 'RUNNING',
    cursor: {
      disposition: 'ACTIVITY_RUNNABLE',
      stepId: STEP_ID,
      stepIndex: 0,
    },
    nextActivation: {
      kind: 'activity',
      status: 'RUNNABLE',
    },
  };
}

function makeOutput() {
  return {
    json: jest.fn(),
    table: jest.fn(),
    success: jest.fn(),
    failure: jest.fn(),
  };
}

/** @param {string[]} options - Command options. */
function nodeArgv(options) {
  return ['node', 'artifact', ...options];
}

describe('durable workflow start command', () => {
  it('mounts matching source and packaged start surfaces with only source directory selection', () => {
    const source = sourceOpsCommand.commands.find(
      (candidate) => candidate.name() === 'start',
    );
    expect(source).toBeDefined();

    const packaged = createPackagedDurableWorkflowStartCommand({
      loadExecution: async () => ({ execution: makeEmbeddedExecution() }),
    });
    const sourceFlags = source?.options.map((option) => option.flags);
    const packagedFlags = packaged.options.map((option) => option.flags);
    expect(sourceFlags).toEqual([
      '--dir <dir>',
      '--workflow <workflowName>',
      '--idempotency-key <idempotencyKey>',
      '--input <json>',
      '--caller-metadata <json>',
      '--json',
    ]);
    expect(packagedFlags).toEqual(sourceFlags?.slice(1));

    const program = createPackagedOperatorProgram({
      loadDurableWorkflowStartExecution: async () => ({
        execution: makeEmbeddedExecution(),
      }),
    });
    const mounted = program.commands.find(
      (candidate) => candidate.name() === 'start',
    );
    expect(sourceOpsCommand.helpInformation()).toMatch(/\bstart\b/);
    expect(program.helpInformation()).toMatch(/\bstart\b/);
    expect(mounted?.helpInformation()).toContain('--workflow <workflowName>');
    expect(mounted?.helpInformation()).not.toContain('--dir');
  });

  it('parses the exact source request defaults and uses revision-stable workflow authority', async () => {
    const embedded = makeEmbeddedExecution();
    const execution = makePreparedExecution(embedded);
    const idempotencyKey = 'stable-source-request';
    const result = makeStartResult(execution, idempotencyKey);
    const cleanup = jest.fn(async () => undefined);
    const loadExecution = jest.fn(
      async (/** @type {Record<string, any>} */ _options = {}) => ({
        execution,
        cleanup,
      }),
    );
    const startWorkflow = jest.fn(
      async (/** @type {Record<string, any>} */ _request = {}) => result,
    );
    const output = makeOutput();
    const processRef = { cwd: jest.fn(() => SOURCE_DIR), exitCode: undefined };
    const command = createDurableWorkflowStartCommand({
      includeDirOption: true,
      loadExecution,
      startWorkflow,
      output,
      processRef,
    });

    await command.parseAsync(
      nodeArgv([
        '--workflow',
        WORKFLOW_ID,
        '--idempotency-key',
        idempotencyKey,
      ]),
    );

    expect(loadExecution).toHaveBeenCalledWith({
      dir: SOURCE_DIR,
      workflow: WORKFLOW_ID,
      idempotencyKey,
    });
    expect(startWorkflow).toHaveBeenCalledWith({
      execution,
      workflowId: WORKFLOW_ID,
      idempotencyKey,
      input: {},
      callerMetadata: {},
      actor: {
        kind: 'workflow-operator',
        id: embedded.embeddedRevision.revision.revisionId,
      },
    });
    const row = expectedRow(execution, idempotencyKey);
    expect(output.table).toHaveBeenCalledWith([row]);
    expect(output.success).toHaveBeenCalledWith(
      `Accepted durable workflow run ${row.run_id}.`,
    );
    expect(output.json).not.toHaveBeenCalled();
    expect(output.failure).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(processRef.exitCode).toBeUndefined();
  });

  it('parses packaged JSON exactly, reuses stable authority, and emits only redacted fields', async () => {
    const execution = makeEmbeddedExecution();
    const idempotencyKey = 'stable-packaged-request';
    const result = makeStartResult(execution, idempotencyKey, false);
    result.outcome.invocation.untrustedSecret = 'never-print-this-token';
    const cleanup = jest.fn(async () => undefined);
    const loadExecution = jest.fn(
      async (/** @type {Record<string, any>} */ _options = {}) => ({
        execution,
        cleanup,
      }),
    );
    const startWorkflow = jest.fn(
      async (/** @type {Record<string, any>} */ _request = {}) => result,
    );
    const output = makeOutput();
    const processRef = { exitCode: undefined };
    const command = createPackagedDurableWorkflowStartCommand({
      loadExecution,
      startWorkflow,
      output,
      processRef,
    });

    await command.parseAsync(
      nodeArgv([
        '--workflow',
        WORKFLOW_ID,
        '--idempotency-key',
        idempotencyKey,
        '--input',
        '{"credential":"cloud-secret"}',
        '--caller-metadata',
        '{"requestId":"request-1"}',
        '--json',
      ]),
    );

    expect(loadExecution).toHaveBeenCalledWith({
      workflow: WORKFLOW_ID,
      idempotencyKey,
      input: '{"credential":"cloud-secret"}',
      callerMetadata: '{"requestId":"request-1"}',
      json: true,
    });
    expect(startWorkflow).toHaveBeenCalledWith({
      execution,
      workflowId: WORKFLOW_ID,
      idempotencyKey,
      input: { credential: 'cloud-secret' },
      callerMetadata: { requestId: 'request-1' },
      actor: {
        kind: 'workflow-operator',
        id: execution.embeddedRevision.revision.revisionId,
      },
    });
    expect(output.json).toHaveBeenCalledWith(
      expectedReceipt(execution, idempotencyKey, true),
    );
    const receipt = /** @type {Record<string, any>} */ (
      output.json.mock.calls[0][0]
    );
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.cursor)).toBe(true);
    expect(Object.isFrozen(receipt.nextActivation)).toBe(true);
    const serializedOutput = JSON.stringify(output.json.mock.calls);
    expect(serializedOutput).not.toContain('cloud-secret');
    expect(serializedOutput).not.toContain('never-print-this-token');
    expect(serializedOutput).not.toContain('secret-plan-reference');
    expect(serializedOutput).not.toContain('secret-start-reference');
    expect(serializedOutput).not.toContain('secret-activity-reference');
    expect(output.table).not.toHaveBeenCalled();
    expect(output.success).not.toHaveBeenCalled();
    expect(output.failure).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(processRef.exitCode).toBeUndefined();
  });

  it('emits the exact same versioned JSON receipt from source and packaged surfaces', async () => {
    const embedded = makeEmbeddedExecution();
    const prepared = makePreparedExecution(embedded);
    const idempotencyKey = 'source-package-json-parity';
    const sourceOutput = makeOutput();
    const packagedOutput = makeOutput();
    const source = createDurableWorkflowStartCommand({
      includeDirOption: true,
      loadExecution: async () => ({ execution: prepared }),
      startWorkflow: async () =>
        makeStartResult(prepared, idempotencyKey, false),
      output: sourceOutput,
      processRef: { cwd: () => SOURCE_DIR, exitCode: undefined },
    });
    const packaged = createPackagedDurableWorkflowStartCommand({
      loadExecution: async () => ({ execution: embedded }),
      startWorkflow: async () =>
        makeStartResult(embedded, idempotencyKey, false),
      output: packagedOutput,
      processRef: { exitCode: undefined },
    });
    const options = [
      '--workflow',
      WORKFLOW_ID,
      '--idempotency-key',
      idempotencyKey,
      '--json',
    ];

    await source.parseAsync(nodeArgv(options));
    await packaged.parseAsync(nodeArgv(options));

    const expected = expectedReceipt(embedded, idempotencyKey, true);
    expect(sourceOutput.json).toHaveBeenCalledWith(expected);
    expect(packagedOutput.json).toHaveBeenCalledWith(expected);
    expect(sourceOutput.json.mock.calls[0][0]).toEqual(
      packagedOutput.json.mock.calls[0][0],
    );
    expect(JSON.stringify(sourceOutput.json.mock.calls[0][0])).toBe(
      JSON.stringify(packagedOutput.json.mock.calls[0][0]),
    );
  });

  it.each([
    {
      kind: 'timer',
      step: { id: 'pause', kind: 'timer', delayMs: 1_000 },
      idKey: 'timerId',
      id: 'timer-activation-1',
      disposition: 'TIMER_WAITING',
      status: 'WAITING',
      resultKey: 'timer',
    },
    {
      kind: 'signal',
      step: { id: 'approval', kind: 'signal' },
      idKey: 'signalWaitId',
      id: 'signal-wait-activation-1',
      disposition: 'SIGNAL_WAITING',
      status: 'WAITING',
      resultKey: 'signalWait',
    },
  ])(
    'formats a $kind-headed start without requiring an invocation',
    async (fixture) => {
      const execution = makeEmbeddedExecution([fixture.step]);
      const { appId, revisionId, manifest } = executionIdentity(execution);
      const idempotencyKey = `${fixture.kind}-headed-start`;
      const runId = createWorkflowRunId({ appId, idempotencyKey });
      const planPayload = normalizeWorkflowPlanPayload({
        schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
        kind: WORKFLOW_PLAN_PAYLOAD_KIND,
        appId,
        revisionId,
        workflowId: WORKFLOW_ID,
        definition: manifest.workflows[WORKFLOW_ID],
      });
      const planId = createWorkflowPlanId(planPayload);
      const continuationId = `${fixture.kind}-continuation-1`;
      const cursor = {
        runId,
        appId,
        revisionId,
        workflowId: WORKFLOW_ID,
        planId,
        continuationId,
        stepId: fixture.step.id,
        stepIndex: 0,
        disposition: fixture.disposition,
        [fixture.idKey]: fixture.id,
      };
      const activation = {
        runId,
        appId,
        revisionId,
        workflowId: WORKFLOW_ID,
        planId,
        continuationId,
        stepId: fixture.step.id,
        stepIndex: 0,
        status: fixture.status,
        [fixture.idKey]: fixture.id,
        privateRef: { payloadId: 'never-print-activation-ref' },
      };
      const output = makeOutput();
      const command = createDurableWorkflowStartCommand({
        loadExecution: async () => ({ execution }),
        startWorkflow: async () => ({
          appId,
          revisionId,
          workflowId: WORKFLOW_ID,
          idempotencyKey,
          runId,
          planId,
          outcome: {
            applied: true,
            run: {
              runId,
              appId,
              revisionId,
              trigger: { kind: 'workflow', workflowId: WORKFLOW_ID, planId },
              status: 'RUNNING',
            },
            workflowCursor: cursor,
            [fixture.resultKey]: activation,
          },
        }),
        output,
        processRef: { exitCode: undefined },
      });

      await command.parseAsync(
        nodeArgv([
          '--workflow',
          WORKFLOW_ID,
          '--idempotency-key',
          idempotencyKey,
          '--json',
        ]),
      );

      expect(output.json).toHaveBeenCalledWith({
        schemaVersion: 1,
        kind: 'wharfie.execution-ledger.workflow-start',
        appId,
        runId,
        revisionId,
        workflowId: WORKFLOW_ID,
        idempotencyKey,
        reused: false,
        runStatus: 'RUNNING',
        cursor: {
          disposition: fixture.disposition,
          stepId: fixture.step.id,
          stepIndex: 0,
        },
        nextActivation: {
          kind: fixture.kind,
          status: fixture.status,
        },
      });
      expect(JSON.stringify(output.json.mock.calls)).not.toContain(
        'never-print-activation-ref',
      );
    },
  );

  it.each([
    ['input', '--input', 'Invalid input JSON.'],
    ['caller metadata', '--caller-metadata', 'Invalid caller metadata JSON.'],
  ])(
    'never echoes a malformed secret-bearing %s value',
    async (_label, flag, message) => {
      const secret = 'start-secret-never-echo';
      const malformed = `{"credential":"${secret}"`;
      const loadExecution = jest.fn(async () => ({
        execution: makeEmbeddedExecution(),
      }));
      const output = makeOutput();
      const command = createDurableWorkflowStartCommand({
        loadExecution,
        output,
        processRef: { exitCode: undefined },
      });

      await command.parseAsync(
        nodeArgv([
          '--workflow',
          WORKFLOW_ID,
          '--idempotency-key',
          'malformed-secret',
          flag,
          malformed,
        ]),
      );

      expect(loadExecution).not.toHaveBeenCalled();
      expect(output.failure).toHaveBeenCalledWith(
        expect.objectContaining({ message }),
      );
      expect(String(output.failure.mock.calls[0][0])).not.toContain(secret);
      expect(String(output.failure.mock.calls[0][0])).not.toContain(malformed);
    },
  );

  it.each([
    [
      'malformed input JSON',
      [
        '--workflow',
        WORKFLOW_ID,
        '--idempotency-key',
        'bad-input',
        '--input',
        '{',
      ],
      'Invalid input JSON.',
    ],
    [
      'malformed caller metadata JSON',
      [
        '--workflow',
        WORKFLOW_ID,
        '--idempotency-key',
        'bad-metadata',
        '--caller-metadata',
        '{',
      ],
      'Invalid caller metadata JSON.',
    ],
    [
      'array caller metadata',
      [
        '--workflow',
        WORKFLOW_ID,
        '--idempotency-key',
        'array-metadata',
        '--caller-metadata',
        '[]',
      ],
      'Caller metadata JSON must be an object.',
    ],
    [
      'null caller metadata',
      [
        '--workflow',
        WORKFLOW_ID,
        '--idempotency-key',
        'null-metadata',
        '--caller-metadata',
        'null',
      ],
      'Caller metadata JSON must be an object.',
    ],
    [
      'empty idempotency key',
      ['--workflow', WORKFLOW_ID, '--idempotency-key', ''],
      '--idempotency-key must be a nonempty string.',
    ],
  ])(
    'rejects %s before loading an execution',
    async (_label, argv, message) => {
      const execution = makeEmbeddedExecution();
      const loadExecution = jest.fn(
        async (/** @type {Record<string, any>} */ _options = {}) => ({
          execution,
        }),
      );
      const startWorkflow = jest.fn(
        async (/** @type {Record<string, any>} */ _request = {}) =>
          makeStartResult(execution, 'unreachable-start'),
      );
      const output = makeOutput();
      const processRef = { exitCode: undefined };
      const command = createDurableWorkflowStartCommand({
        loadExecution,
        startWorkflow,
        output,
        processRef,
      });

      await command.parseAsync(nodeArgv(argv));

      expect(loadExecution).not.toHaveBeenCalled();
      expect(startWorkflow).not.toHaveBeenCalled();
      expect(output.failure).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining(message) }),
      );
      expect(processRef.exitCode).toBe(1);
    },
  );

  it.each([
    [
      'workflow',
      ['--idempotency-key', 'missing-workflow'],
      "required option '--workflow <workflowName>' not specified",
    ],
    [
      'idempotency key',
      ['--workflow', WORKFLOW_ID],
      "required option '--idempotency-key <idempotencyKey>' not specified",
    ],
  ])(
    'lets Commander reject a missing required %s flag',
    async (_label, argv, message) => {
      const loadExecution = jest.fn(
        async (/** @type {Record<string, any>} */ _options = {}) => ({
          execution: makeEmbeddedExecution(),
        }),
      );
      const command = createDurableWorkflowStartCommand({ loadExecution });
      command.exitOverride();
      command.configureOutput({ writeErr: jest.fn() });

      await expect(command.parseAsync(nodeArgv(argv))).rejects.toMatchObject({
        code: 'commander.missingMandatoryOptionValue',
        message: expect.stringContaining(message),
      });
      expect(loadExecution).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'top-level app',
      (/** @type {Record<string, any>} */ result) =>
        (result.appId = 'unexpected-app'),
    ],
    [
      'top-level revision',
      (/** @type {Record<string, any>} */ result) =>
        (result.revisionId = 'unexpected-rev'),
    ],
    [
      'top-level run',
      (/** @type {Record<string, any>} */ result) =>
        (result.runId = 'unexpected-run'),
    ],
    [
      'run workflow',
      (/** @type {Record<string, any>} */ result) =>
        (result.outcome.run.trigger.workflowId = 'unexpected-flow'),
    ],
    [
      'cursor plan',
      (/** @type {Record<string, any>} */ result) =>
        (result.outcome.workflowCursor.planId = 'unexpected-plan'),
    ],
    [
      'cursor invocation',
      (/** @type {Record<string, any>} */ result) =>
        (result.outcome.workflowCursor.invocationId = 'unexpected-invocation'),
    ],
  ])('rejects an unexpected returned %s identity', async (_label, mutate) => {
    const execution = makeEmbeddedExecution();
    const idempotencyKey = 'unexpected-returned-identity';
    const result = makeStartResult(execution, idempotencyKey);
    mutate(result);
    const cleanup = jest.fn(async () => undefined);
    const output = makeOutput();
    const processRef = { exitCode: undefined };
    const command = createDurableWorkflowStartCommand({
      loadExecution: async () => ({ execution, cleanup }),
      startWorkflow: async () => result,
      output,
      processRef,
    });

    await command.parseAsync(
      nodeArgv([
        '--workflow',
        WORKFLOW_ID,
        '--idempotency-key',
        idempotencyKey,
      ]),
    );

    expect(output.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Durable workflow start returned an unexpected immutable identity.',
      }),
    );
    expect(output.json).not.toHaveBeenCalled();
    expect(output.table).not.toHaveBeenCalled();
    expect(output.success).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(processRef.exitCode).toBe(1);
  });

  it('rejects incomplete returned projections and still cleans up', async () => {
    const execution = makeEmbeddedExecution();
    const cleanup = jest.fn(async () => undefined);
    const output = makeOutput();
    const processRef = { exitCode: undefined };
    const command = createDurableWorkflowStartCommand({
      loadExecution: async () => ({ execution, cleanup }),
      startWorkflow: async () => ({ outcome: { applied: true } }),
      output,
      processRef,
    });

    await command.parseAsync(
      nodeArgv([
        '--workflow',
        WORKFLOW_ID,
        '--idempotency-key',
        'incomplete-result',
      ]),
    );

    expect(output.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Durable workflow start returned an unexpected immutable identity.',
      }),
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(processRef.exitCode).toBe(1);
  });

  it('always cleans up and aggregates start and cleanup failures', async () => {
    const execution = makeEmbeddedExecution();
    const startError = new Error('start failed');
    const cleanupError = new Error('cleanup failed');
    const cleanup = jest.fn(async () => {
      throw cleanupError;
    });
    const output = makeOutput();
    const processRef = { exitCode: undefined };
    const command = createDurableWorkflowStartCommand({
      loadExecution: async () => ({ execution, cleanup }),
      startWorkflow: async () => {
        throw startError;
      },
      output,
      processRef,
    });

    await command.parseAsync(
      nodeArgv([
        '--workflow',
        WORKFLOW_ID,
        '--idempotency-key',
        'double-failure',
      ]),
    );

    expect(cleanup).toHaveBeenCalledTimes(1);
    const failure = output.failure.mock.calls[0]?.[0];
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      message: 'Durable workflow start and cleanup both failed.',
      errors: [startError, cleanupError],
    });
    expect(output.json).not.toHaveBeenCalled();
    expect(output.table).not.toHaveBeenCalled();
    expect(output.success).not.toHaveBeenCalled();
    expect(processRef.exitCode).toBe(1);
  });

  it('reports a cleanup-only failure after a successful start', async () => {
    const execution = makeEmbeddedExecution();
    const idempotencyKey = 'cleanup-only-failure';
    const cleanupError = new Error('cleanup failed');
    const cleanup = jest.fn(async () => {
      throw cleanupError;
    });
    const output = makeOutput();
    const processRef = { exitCode: undefined };
    const command = createDurableWorkflowStartCommand({
      loadExecution: async () => ({ execution, cleanup }),
      startWorkflow: async () => makeStartResult(execution, idempotencyKey),
      output,
      processRef,
    });

    await command.parseAsync(
      nodeArgv([
        '--workflow',
        WORKFLOW_ID,
        '--idempotency-key',
        idempotencyKey,
        '--json',
      ]),
    );

    expect(output.json).toHaveBeenCalledWith(
      expectedReceipt(execution, idempotencyKey),
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(output.failure).toHaveBeenCalledWith(cleanupError);
    expect(processRef.exitCode).toBe(1);
  });

  it('requires a loader and validates its handle before starting', async () => {
    expect(() =>
      createDurableWorkflowStartCommand(/** @type {any} */ ({})),
    ).toThrow('createDurableWorkflowStartCommand requires loadExecution.');

    const startWorkflow = jest.fn(
      async (/** @type {Record<string, any>} */ _request = {}) => ({}),
    );
    const output = makeOutput();
    const processRef = { exitCode: undefined };
    const command = createDurableWorkflowStartCommand({
      loadExecution: async () =>
        /** @type {any} */ ({
          execution: makeEmbeddedExecution(),
          cleanup: true,
        }),
      startWorkflow,
      output,
      processRef,
    });
    await command.parseAsync(
      nodeArgv([
        '--workflow',
        WORKFLOW_ID,
        '--idempotency-key',
        'bad-loader-handle',
      ]),
    );

    expect(startWorkflow).not.toHaveBeenCalled();
    expect(output.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Workflow start execution cleanup must be a function when provided.',
      }),
    );
    expect(processRef.exitCode).toBe(1);
  });
});
