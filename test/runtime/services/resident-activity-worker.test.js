/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';

import {
  AttemptStatus,
  EffectStatus,
  ExecutionLedgerConflictError,
  InvocationStatus,
  RunStatus,
} from '../../../src/core/lib/db/tables/execution-ledger.js';
import {
  WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
  WORKFLOW_PLAN_PAYLOAD_KIND,
  WorkflowCursorDisposition,
  createWorkflowPlanId,
  createWorkflowRunId,
} from '../../../src/core/lib/ledger/workflow-execution-contract.js';
import {
  LedgerServiceOwnerKind,
  createLedgerServiceId,
} from '../../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
} from '../../../src/core/resources/builds/lib/revision-runtime-assets.js';
import {
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
  createApplicationRevision,
} from '../../../src/core/runtime/application-revision.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
} from '../../../src/core/runtime/manual-ledger-run.js';
import {
  LOCAL_OWNER_COMMAND_MAX_REQUEST_BYTES,
  LOCAL_OWNER_COMMAND_MAX_TIMEOUT_MS,
} from '../../../src/core/runtime/operator/local-owner-command.js';
import {
  RESIDENT_ACTIVITY_READY_WORK_LIMIT,
  RESIDENT_ACTIVITY_SUBMIT_COMMAND,
  RESIDENT_WORKFLOW_START_COMMAND,
  runResidentActivityWorker,
} from '../../../src/core/runtime/services/resident-activity-worker.js';

/** @typedef {import('../../../src/core/lib/db/base.js').DBClient} DBClient */
/** @typedef {import('../../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ExecutionLedgerStore */
/** @typedef {import('../../../src/core/runtime/durable-activity-host.js').ManifestActivityExecution} ManifestActivityExecution */
/** @typedef {Extract<ManifestActivityExecution, {kind: 'embedded'}>} EmbeddedExecution */
/** @typedef {typeof import('../../../src/core/runtime/durable-activity-host.js').runPersistedDurableManifestActivity} RunActivity */
/** @typedef {typeof import('../../../src/core/runtime/durable-workflow-host.js').runPersistedDurableManifestWorkflowActivity} RunWorkflowActivity */
/** @typedef {typeof import('../../../src/core/runtime/durable-activity-host.js').submitDurableManifestActivity} SubmitActivity */
/** @typedef {typeof import('../../../src/core/runtime/durable-workflow-host.js').startDurableManifestWorkflow} StartWorkflow */
/** @typedef {typeof import('../../../src/core/runtime/manual-ledger-run.js').recoverManualLedgerActivity} RecoverActivity */
/** @typedef {typeof import('../../../src/core/runtime/workflow-ledger-run.js').recoverWorkflowLedgerActivity} RecoverWorkflowActivity */
/** @typedef {typeof import('../../../src/core/runtime/operator/local-owner-command.js').createLocalOwnerCommandServer} CommandServerFactory */
/** @typedef {Parameters<RunActivity>[0]} RunActivityOptions */
/** @typedef {Parameters<RunWorkflowActivity>[0]} RunWorkflowActivityOptions */
/** @typedef {Parameters<CommandServerFactory>[0]} CommandServerOptions */
/** @typedef {'RUNNING'|'BLOCKED'|'COMPLETED'|'FAILED'|'CANCELLED'} RunStatusValue */
/** @typedef {'RUNNABLE'|'RUNNING'|'UNCERTAIN'|'COMPLETED'|'FAILED'|'CANCELLED'} InvocationStatusValue */
/** @typedef {'CLAIMED'|'STARTED'|'COMPLETED'|'FAILED'|'CANCELLED'|'ABANDONED'} AttemptStatusValue */
/** @template T @typedef {{promise: Promise<T>, resolve: (value: T) => void, reject: (reason?: unknown) => void}} Deferred */

const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const WORKFLOW_ID = 'main';
const WORKFLOW_STEP_ID = 'greet-step';
const WORKFLOW_ACTIVITY_ID = 'greet';
const WORKFLOW_INVOCATION_ID = 'workflow-invocation-1';
const WORKFLOW_CONTINUATION_ID = 'workflow-continuation-1';

/** @param {string} value */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/** @returns {EmbeddedExecution} */
function makeEmbeddedExecution() {
  const contract = {
    schemaVersion: 2,
    app: { id: 'resident-worker-demo' },
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
        steps: [
          {
            id: WORKFLOW_STEP_ID,
            kind: 'activity',
            activity: WORKFLOW_ACTIVITY_ID,
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
        appId: contract.app.id,
        revisionId: revision.revisionId,
        target: { ...TARGET },
      },
    },
  });
}

/** @param {EmbeddedExecution} execution */
function workflowPlanId(execution) {
  return createWorkflowPlanId({
    schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
    kind: WORKFLOW_PLAN_PAYLOAD_KIND,
    appId: execution.embeddedRevision.runtime.appId,
    revisionId: execution.embeddedRevision.runtime.revisionId,
    workflowId: WORKFLOW_ID,
    definition: execution.manifest.workflows[WORKFLOW_ID],
  });
}

/** @param {EmbeddedExecution} execution */
function makeHarness(execution) {
  const appId = execution.embeddedRevision.runtime.appId;
  const revisionId = execution.embeddedRevision.runtime.revisionId;
  const serviceId = createLedgerServiceId({ appId });
  const close = jest.fn(async () => undefined);
  /** @type {CommandServerOptions | undefined} */
  let commandServerOptions;
  const commandServerMock = jest.fn(
    async (/** @type {CommandServerOptions} */ options) => {
      commandServerOptions = options;
      return { close };
    },
  );
  const createCommandServer = /** @type {CommandServerFactory} */ (
    /** @type {unknown} */ (commandServerMock)
  );
  const db = /** @type {DBClient} */ (
    /** @type {unknown} */ ({
      get: jest.fn(async () => null),
      transactionWrite: jest.fn(async () => undefined),
    })
  );
  const controlContext =
    /** @type {Parameters<typeof runResidentActivityWorker>[0]['controlContext']} */ ({
      db,
      adapterName: 'lmdb',
      controlPath: '/tmp/resident-worker-test',
      tableName: 'resident-worker-test',
    });
  return {
    appId,
    revisionId,
    controlContext,
    owner: {
      serviceId,
      commandSession: { serviceId },
      ownership: {
        serviceId,
        appId,
        scopeId: 'local-machine',
        principalId: 'test-principal',
        sessionId: 'test-session',
        ownerKind: LedgerServiceOwnerKind.RESIDENT,
        generation: 1,
      },
    },
    createCommandServer,
    close,
    getCommandServerOptions() {
      if (!commandServerOptions) {
        throw new Error('Resident command server was not created.');
      }
      return commandServerOptions;
    },
  };
}

/**
 * @param {{appId: string, revisionId: string, runId: string, kind?: 'ACTIVITY'|'RECOVERY', generation?: number, attemptId?: string, availableAt?: number, version?: number, lastSequence?: number}} options
 * @returns {Record<string, any>}
 */
function makeRow({
  appId,
  revisionId,
  runId,
  kind = 'ACTIVITY',
  generation = kind === 'RECOVERY' ? 1 : 0,
  attemptId = 'resident-attempt-1',
  availableAt = 0,
  version = 1,
  lastSequence = 1,
}) {
  return {
    kind,
    appId,
    revisionId,
    runId,
    availableAt,
    runVersion: version,
    lastSequence,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    generation,
    ...(kind === 'RECOVERY' ? { attemptId } : {}),
  };
}

/**
 * @param {{appId: string, revisionId: string, runId: string, runStatus?: RunStatusValue, invocationStatus?: InvocationStatusValue, attemptStatus?: AttemptStatusValue, generation?: number, version?: number, lastSequence?: number, availableAt?: number, effects?: Record<string, any>[]}} options
 * @returns {Record<string, any>}
 */
function makeView({
  appId,
  revisionId,
  runId,
  runStatus = RunStatus.RUNNING,
  invocationStatus = InvocationStatus.RUNNABLE,
  attemptStatus,
  generation = attemptStatus ? 1 : 0,
  version = 1,
  lastSequence = 1,
  availableAt = 0,
  effects = [],
}) {
  return {
    run: {
      kind: 'manual',
      appId,
      revisionId,
      runId,
      trigger: { kind: 'manual' },
      status: runStatus,
      version,
      lastSequence,
    },
    invocations: [
      {
        runId,
        appId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        revisionId,
        activityId: 'greet',
        status: invocationStatus,
        generation,
        updatedAt: availableAt,
      },
    ],
    attempts:
      attemptStatus === undefined
        ? []
        : [
            {
              invocationId: MANUAL_LEDGER_INVOCATION_ID,
              attemptId: 'resident-attempt-1',
              fencingToken: 'resident-fence-1',
              generation,
              status: attemptStatus,
              updatedAt: availableAt,
            },
          ],
    effects,
  };
}

/**
 * @param {{appId: string, revisionId: string, runId: string, kind?: 'ACTIVITY'|'RECOVERY', invocationId?: string, generation?: number, attemptId?: string, availableAt?: number, version?: number, lastSequence?: number, cursorVersion?: number, continuationId?: string, stepId?: string, stepIndex?: number}} options
 * @returns {Record<string, any>}
 */
function makeWorkflowRow({
  appId,
  revisionId,
  runId,
  kind = 'ACTIVITY',
  invocationId = WORKFLOW_INVOCATION_ID,
  generation = kind === 'RECOVERY' ? 1 : 0,
  attemptId = 'workflow-attempt-1',
  availableAt = 0,
  version = 1,
  lastSequence = 1,
  cursorVersion = version,
  continuationId = WORKFLOW_CONTINUATION_ID,
  stepId = WORKFLOW_STEP_ID,
  stepIndex = 0,
}) {
  return {
    kind,
    appId,
    revisionId,
    runId,
    availableAt,
    runVersion: version,
    lastSequence,
    invocationId,
    generation,
    cursorVersion,
    continuationId,
    stepId,
    stepIndex,
    ...(kind === 'RECOVERY' ? { attemptId } : {}),
  };
}

/**
 * @param {{appId: string, revisionId: string, runId: string, planId: string, runStatus?: RunStatusValue, invocationStatus?: InvocationStatusValue, cursorDisposition?: string, attemptStatus?: AttemptStatusValue, invocationId?: string, activityId?: string, generation?: number, attemptId?: string, version?: number, lastSequence?: number, cursorVersion?: number, availableAt?: number, continuationId?: string, stepId?: string, stepIndex?: number}} options
 * @returns {Record<string, any>}
 */
function makeWorkflowView({
  appId,
  revisionId,
  runId,
  planId,
  runStatus = RunStatus.RUNNING,
  invocationStatus = InvocationStatus.RUNNABLE,
  cursorDisposition = invocationStatus === InvocationStatus.RUNNABLE
    ? WorkflowCursorDisposition.ACTIVITY_RUNNABLE
    : invocationStatus === InvocationStatus.UNCERTAIN
      ? WorkflowCursorDisposition.ACTIVITY_UNCERTAIN
      : WorkflowCursorDisposition.ACTIVITY_RUNNING,
  attemptStatus,
  invocationId = WORKFLOW_INVOCATION_ID,
  activityId = WORKFLOW_ACTIVITY_ID,
  generation = attemptStatus ? 1 : 0,
  attemptId = 'workflow-attempt-1',
  version = 1,
  lastSequence = 1,
  cursorVersion = version,
  availableAt = 0,
  continuationId = WORKFLOW_CONTINUATION_ID,
  stepId = WORKFLOW_STEP_ID,
  stepIndex = 0,
}) {
  return {
    run: {
      kind: 'workflow',
      appId,
      revisionId,
      runId,
      trigger: { kind: 'workflow', workflowId: WORKFLOW_ID, planId },
      status: runStatus,
      version,
      lastSequence,
    },
    workflowCursor: {
      runId,
      appId,
      revisionId,
      workflowId: WORKFLOW_ID,
      planId,
      invocationId,
      continuationId,
      stepId,
      stepIndex,
      disposition: cursorDisposition,
      outputs: [],
      version: cursorVersion,
      lastSequence,
      updatedAt: availableAt,
    },
    invocations: [
      {
        runId,
        appId,
        revisionId,
        invocationId,
        activityId,
        status: invocationStatus,
        generation,
        updatedAt: availableAt,
        workflow: {
          workflowId: WORKFLOW_ID,
          planId,
          continuationId,
          stepId,
          stepIndex,
        },
      },
    ],
    attempts:
      attemptStatus === undefined
        ? []
        : [
            {
              runId,
              appId,
              revisionId,
              invocationId,
              activityId,
              attemptId,
              fencingToken: 'workflow-fence-1',
              coordinatorEpoch: 0,
              generation,
              status: attemptStatus,
              updatedAt: availableAt,
            },
          ],
    effects: [],
  };
}

/**
 * @template T
 * @returns {Deferred<T>}
 */
function deferred() {
  /** @type {(value: T) => void} */
  let resolveDeferred = () => undefined;
  /** @type {(reason?: unknown) => void} */
  let rejectDeferred = () => undefined;
  const promise = new Promise((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred,
  };
}

/** @param {() => boolean} predicate */
async function waitUntil(predicate, remaining = 100) {
  if (predicate()) return;
  if (remaining === 0) {
    throw new Error('Timed out waiting for resident worker test state.');
  }
  await new Promise((resolve) => setImmediate(resolve));
  await waitUntil(predicate, remaining - 1);
}

/**
 * @template {object} T
 * @param {T} ledger
 * @returns {T & ExecutionLedgerStore}
 */
function asExecutionLedger(ledger) {
  return /** @type {T & ExecutionLedgerStore} */ (
    /** @type {unknown} */ (ledger)
  );
}

/** @param {unknown} mock @returns {RunActivity} */
function asRunActivity(mock) {
  return /** @type {RunActivity} */ (mock);
}

/** @param {unknown} mock @returns {RunWorkflowActivity} */
function asRunWorkflowActivity(mock) {
  return /** @type {RunWorkflowActivity} */ (mock);
}

/** @param {unknown} mock @returns {SubmitActivity} */
function asSubmitActivity(mock) {
  return /** @type {SubmitActivity} */ (mock);
}

/** @param {unknown} mock @returns {StartWorkflow} */
function asStartWorkflow(mock) {
  return /** @type {StartWorkflow} */ (mock);
}

/** @param {unknown} mock @returns {RecoverActivity} */
function asRecoverActivity(mock) {
  return /** @type {RecoverActivity} */ (mock);
}

/** @param {unknown} mock @returns {RecoverWorkflowActivity} */
function asRecoverWorkflowActivity(mock) {
  return /** @type {RecoverWorkflowActivity} */ (mock);
}

describe('resident activity worker', () => {
  it('dispatches verified locator results serially', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const firstRunId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'serial-first',
    });
    const secondRunId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'serial-second',
    });
    const rows = [
      makeRow({ ...harness, runId: firstRunId }),
      makeRow({ ...harness, runId: secondRunId }),
    ];
    let firstView = makeView({ ...harness, runId: firstRunId });
    const secondView = makeView({ ...harness, runId: secondRunId });
    const ledger = {
      listReadyWork: jest.fn(
        async (
          /** @type {{appId: string, revisionId: string, limit: number}} */ _options,
        ) => ({ items: rows }),
      ),
      rebuildRun: jest.fn(async (runId) =>
        runId === firstRunId ? firstView : secondView,
      ),
    };
    /** @type {Deferred<void>} */
    const releaseFirstAttempt = deferred();
    let activeAttempts = 0;
    let maximumActiveAttempts = 0;
    const runActivity = jest.fn(
      async (/** @type {RunActivityOptions} */ { runId }) => {
        activeAttempts += 1;
        maximumActiveAttempts = Math.max(maximumActiveAttempts, activeAttempts);
        try {
          if (runId === firstRunId) {
            await releaseFirstAttempt.promise;
            firstView = makeView({
              ...harness,
              runId: firstRunId,
              runStatus: RunStatus.COMPLETED,
              invocationStatus: InvocationStatus.COMPLETED,
            });
          } else {
            controller.abort();
          }
        } finally {
          activeAttempts -= 1;
        }
      },
    );

    const running = runResidentActivityWorker({
      ledger: asExecutionLedger(ledger),
      execution,
      controlContext: harness.controlContext,
      owner: harness.owner,
      signal: controller.signal,
      runActivity: asRunActivity(runActivity),
      recoverActivity: asRecoverActivity(jest.fn()),
      createCommandServer: harness.createCommandServer,
    });
    await waitUntil(() => runActivity.mock.calls.length === 1);
    await new Promise((resolve) => setImmediate(resolve));

    expect(runActivity).toHaveBeenCalledTimes(1);
    expect(runActivity.mock.calls[0][0].runId).toBe(firstRunId);
    releaseFirstAttempt.resolve();

    await expect(running).resolves.toEqual({ processed: 2 });
    expect(runActivity.mock.calls.map(([request]) => request.runId)).toEqual([
      firstRunId,
      secondRunId,
    ]);
    expect(maximumActiveAttempts).toBe(1);
    expect(ledger.rebuildRun.mock.calls.map(([runId]) => runId)).toEqual([
      firstRunId,
      firstRunId,
      secondRunId,
    ]);
    expect(ledger.listReadyWork).toHaveBeenCalledWith({
      appId: harness.appId,
      revisionId: harness.revisionId,
      limit: RESIDENT_ACTIVITY_READY_WORK_LIMIT,
    });
  });

  it('skips a stale locator before dispatching later exact ready work', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const terminalRunId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'stale-ready-row',
    });
    const runnableRunId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'later-ready-row',
    });
    const ledger = {
      listReadyWork: jest.fn(
        async (
          /** @type {{appId: string, revisionId: string, limit: number}} */ _options,
        ) => ({
          items: [
            makeRow({ ...harness, runId: terminalRunId }),
            makeRow({ ...harness, runId: runnableRunId }),
          ],
        }),
      ),
      rebuildRun: jest.fn(async (/** @type {string} */ runId) =>
        makeView({
          ...harness,
          runId,
          ...(runId === terminalRunId
            ? {
                runStatus: RunStatus.COMPLETED,
                invocationStatus: InvocationStatus.COMPLETED,
              }
            : {}),
        }),
      ),
    };
    const runActivity = jest.fn(
      async (/** @type {RunActivityOptions} */ _options) => {
        controller.abort();
      },
    );

    await expect(
      runResidentActivityWorker({
        ledger: asExecutionLedger(ledger),
        execution,
        controlContext: harness.controlContext,
        owner: harness.owner,
        signal: controller.signal,
        runActivity: asRunActivity(runActivity),
        recoverActivity: asRecoverActivity(jest.fn()),
        createCommandServer: harness.createCommandServer,
      }),
    ).resolves.toEqual({ processed: 1 });

    expect(ledger.listReadyWork.mock.calls.map(([request]) => request)).toEqual(
      [
        {
          appId: harness.appId,
          revisionId: harness.revisionId,
          limit: RESIDENT_ACTIVITY_READY_WORK_LIMIT,
        },
      ],
    );
    expect(ledger.rebuildRun).toHaveBeenCalledTimes(2);
    expect(runActivity).toHaveBeenCalledWith(
      expect.objectContaining({ runId: runnableRunId }),
    );
  });

  it('repairs an exact stale locator without losing a concurrent repair race', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const staleRunId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'repair-stale-ready-row',
    });
    const runnableRunId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'ready-after-repair-race',
    });
    const staleRow = makeRow({ ...harness, runId: staleRunId });
    const runnableRow = makeRow({ ...harness, runId: runnableRunId });
    const repairReadyWork = jest.fn(
      async (/** @type {Record<string, any>} */ _options) => {
        throw new ExecutionLedgerConflictError(staleRunId, 'repair race');
      },
    );
    const ledger = {
      listReadyWork: jest.fn(async () => ({
        items: [staleRow, runnableRow],
      })),
      rebuildRun: jest.fn(async (/** @type {string} */ runId) =>
        makeView({
          ...harness,
          runId,
          ...(runId === staleRunId
            ? {
                runStatus: RunStatus.COMPLETED,
                invocationStatus: InvocationStatus.COMPLETED,
              }
            : {}),
        }),
      ),
      repairReadyWork,
    };
    const runActivity = jest.fn(
      async (/** @type {RunActivityOptions} */ _options) => controller.abort(),
    );

    await expect(
      runResidentActivityWorker({
        ledger: asExecutionLedger(ledger),
        execution,
        controlContext: harness.controlContext,
        owner: harness.owner,
        signal: controller.signal,
        runActivity: asRunActivity(runActivity),
        recoverActivity: asRecoverActivity(jest.fn()),
        createCommandServer: harness.createCommandServer,
      }),
    ).resolves.toEqual({ processed: 1 });

    expect(repairReadyWork).toHaveBeenCalledTimes(1);
    expect(repairReadyWork).toHaveBeenCalledWith({
      appId: harness.appId,
      revisionId: harness.revisionId,
      runId: staleRunId,
      observed: staleRow,
    });
    expect(runActivity).toHaveBeenCalledTimes(1);
    expect(runActivity).toHaveBeenCalledWith(
      expect.objectContaining({ runId: runnableRunId }),
    );
    expect(runActivity).not.toHaveBeenCalledWith(
      expect.objectContaining({ runId: staleRunId }),
    );
  });

  it('continues through a full stale page to exact work on the next cursor', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const stale = Array.from(
      { length: RESIDENT_ACTIVITY_READY_WORK_LIMIT },
      (_, index) => {
        const runId = createManualLedgerRunId({
          appId: harness.appId,
          idempotencyKey: `stale-page-one-${index}`,
        });
        const availableAt = 100 + index;
        return {
          row: makeRow({ ...harness, runId, availableAt }),
          view: makeView({
            ...harness,
            runId,
            availableAt,
            runStatus: RunStatus.COMPLETED,
            invocationStatus: InvocationStatus.COMPLETED,
          }),
        };
      },
    );
    const runnableRunId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'ready-page-two',
    });
    const runnableAvailableAt = 1_000;
    const nextCursor = 'opaque-ready-work-page-two';
    const ledger = {
      listReadyWork: jest.fn(
        async (
          /** @type {{appId: string, revisionId: string, limit: number, cursor?: string}} */ options,
        ) =>
          options.cursor === undefined
            ? { items: stale.map(({ row }) => row), nextCursor }
            : {
                items: [
                  makeRow({
                    ...harness,
                    runId: runnableRunId,
                    availableAt: runnableAvailableAt,
                  }),
                ],
              },
      ),
      rebuildRun: jest.fn(async (/** @type {string} */ runId) => {
        const staleEntry = stale.find(({ row }) => row.runId === runId);
        return (
          staleEntry?.view ||
          makeView({
            ...harness,
            runId: runnableRunId,
            availableAt: runnableAvailableAt,
          })
        );
      }),
    };
    const runActivity = jest.fn(
      async (/** @type {RunActivityOptions} */ _options) => controller.abort(),
    );

    await expect(
      runResidentActivityWorker({
        ledger: asExecutionLedger(ledger),
        execution,
        controlContext: harness.controlContext,
        owner: harness.owner,
        signal: controller.signal,
        runActivity: asRunActivity(runActivity),
        recoverActivity: asRecoverActivity(jest.fn()),
        createCommandServer: harness.createCommandServer,
      }),
    ).resolves.toEqual({ processed: 1 });

    expect(ledger.listReadyWork.mock.calls.map(([request]) => request)).toEqual(
      [
        {
          appId: harness.appId,
          revisionId: harness.revisionId,
          limit: RESIDENT_ACTIVITY_READY_WORK_LIMIT,
        },
        {
          appId: harness.appId,
          revisionId: harness.revisionId,
          limit: RESIDENT_ACTIVITY_READY_WORK_LIMIT,
          cursor: nextCursor,
        },
      ],
    );
    expect(ledger.rebuildRun).toHaveBeenCalledTimes(
      RESIDENT_ACTIVITY_READY_WORK_LIMIT + 1,
    );
    expect(runActivity).toHaveBeenCalledWith(
      expect.objectContaining({ runId: runnableRunId }),
    );
  });

  it('rejects ready-work rows that do not match exact execution authority', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    /** @param {string} idempotencyKey */
    const runId = (idempotencyKey) =>
      createManualLedgerRunId({ appId: harness.appId, idempotencyKey });
    const wrongVersionRunId = runId('wrong-ready-version');
    const nonManualRunId = runId('non-manual-ready-trigger');
    const wrongGenerationRunId = runId('wrong-ready-generation');
    const wrongAttemptRunId = runId('wrong-ready-attempt');
    const exactRunId = runId('exact-ready-authority');
    const ledger = {
      listReadyWork: jest.fn(async () => ({
        items: [
          makeRow({ ...harness, runId: wrongVersionRunId, version: 2 }),
          makeRow({ ...harness, runId: nonManualRunId }),
          makeRow({ ...harness, runId: wrongGenerationRunId, generation: 1 }),
          makeRow({
            ...harness,
            runId: wrongAttemptRunId,
            kind: 'RECOVERY',
            attemptId: 'different-attempt',
          }),
          makeRow({ ...harness, runId: exactRunId }),
        ],
      })),
      rebuildRun: jest.fn(async (/** @type {string} */ candidateRunId) => {
        const view = makeView({
          ...harness,
          runId: candidateRunId,
          ...(candidateRunId === wrongAttemptRunId
            ? {
                invocationStatus: InvocationStatus.RUNNING,
                attemptStatus: AttemptStatus.CLAIMED,
              }
            : {}),
        });
        if (candidateRunId === nonManualRunId) {
          view.run.trigger = { kind: 'workflow', workflowId: 'not-manual' };
        }
        return view;
      }),
    };
    const recoverActivity = jest.fn();
    const runActivity = jest.fn(
      async (/** @type {RunActivityOptions} */ _options) => controller.abort(),
    );

    await expect(
      runResidentActivityWorker({
        ledger: asExecutionLedger(ledger),
        execution,
        controlContext: harness.controlContext,
        owner: harness.owner,
        signal: controller.signal,
        runActivity: asRunActivity(runActivity),
        recoverActivity: asRecoverActivity(recoverActivity),
        createCommandServer: harness.createCommandServer,
      }),
    ).resolves.toEqual({ processed: 1 });

    expect(recoverActivity).not.toHaveBeenCalled();
    expect(runActivity).toHaveBeenCalledTimes(1);
    expect(runActivity).toHaveBeenCalledWith(
      expect.objectContaining({ runId: exactRunId }),
    );
  });

  it('routes an exact workflow activity only to the workflow runner', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const planId = workflowPlanId(execution);
    const runId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'exact-workflow-activity',
    });
    const ledger = {
      listReadyWork: jest.fn(async () => ({
        items: [makeWorkflowRow({ ...harness, runId })],
      })),
      rebuildRun: jest.fn(async () =>
        makeWorkflowView({ ...harness, runId, planId }),
      ),
    };
    const runActivity = jest.fn();
    const recoverActivity = jest.fn();
    const recoverWorkflowActivity = jest.fn();
    const runWorkflowActivity = jest.fn(
      async (/** @type {RunWorkflowActivityOptions} */ _options) => {
        controller.abort();
        return { outcome: { dispatched: true } };
      },
    );

    await expect(
      runResidentActivityWorker({
        ledger: asExecutionLedger(ledger),
        execution,
        controlContext: harness.controlContext,
        owner: harness.owner,
        signal: controller.signal,
        runActivity: asRunActivity(runActivity),
        runWorkflowActivity: asRunWorkflowActivity(runWorkflowActivity),
        recoverActivity: asRecoverActivity(recoverActivity),
        recoverWorkflowActivity: asRecoverWorkflowActivity(
          recoverWorkflowActivity,
        ),
        createCommandServer: harness.createCommandServer,
      }),
    ).resolves.toEqual({ processed: 1 });

    expect(runActivity).not.toHaveBeenCalled();
    expect(recoverActivity).not.toHaveBeenCalled();
    expect(recoverWorkflowActivity).not.toHaveBeenCalled();
    expect(runWorkflowActivity).toHaveBeenCalledTimes(1);
    const request = runWorkflowActivity.mock.calls[0][0];
    expect(request).toEqual({
      ledger: asExecutionLedger(ledger),
      execution,
      runId,
      workflowId: WORKFLOW_ID,
      planId,
      invocationId: WORKFLOW_INVOCATION_ID,
      activityId: WORKFLOW_ACTIVITY_ID,
      generation: 0,
      cursor: {
        version: 1,
        continuationId: WORKFLOW_CONTINUATION_ID,
        stepId: WORKFLOW_STEP_ID,
        stepIndex: 0,
      },
      actor: { kind: 'resident-workflow', id: harness.appId },
      admissionSignal: controller.signal,
      signal: expect.any(AbortSignal),
    });
    expect(request).not.toHaveProperty('controlContext');
    expect(request).not.toHaveProperty('ownerCancellation');
    expect(request).not.toHaveProperty('registerActiveAttemptCancellationPort');
  });

  it('repairs stale workflow head, cursor, and generation rows before exact dispatch', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const planId = workflowPlanId(execution);
    /** @param {string} idempotencyKey */
    const runId = (idempotencyKey) =>
      createManualLedgerRunId({ appId: harness.appId, idempotencyKey });
    const wrongRevisionRunId = runId('workflow-wrong-revision');
    const staleHeadRunId = runId('workflow-stale-head');
    const staleCursorRunId = runId('workflow-stale-cursor');
    const staleGenerationRunId = runId('workflow-stale-generation');
    const mismatchedPlanRunId = runId('workflow-mismatched-manifest-plan');
    const exactRunId = runId('workflow-exact-after-stale');
    const wrongRevisionRow = makeWorkflowRow({
      ...harness,
      revisionId: `${harness.revisionId}-other`,
      runId: wrongRevisionRunId,
    });
    const staleHeadRow = makeWorkflowRow({
      ...harness,
      runId: staleHeadRunId,
      version: 2,
      lastSequence: 2,
    });
    const staleCursorRow = makeWorkflowRow({
      ...harness,
      runId: staleCursorRunId,
      cursorVersion: 2,
    });
    const staleGenerationRow = makeWorkflowRow({
      ...harness,
      runId: staleGenerationRunId,
      generation: 1,
    });
    const mismatchedPlanRow = makeWorkflowRow({
      ...harness,
      runId: mismatchedPlanRunId,
    });
    const exactRow = makeWorkflowRow({ ...harness, runId: exactRunId });
    const repairReadyWork = jest.fn(
      async (/** @type {Record<string, any>} */ _options) => undefined,
    );
    const ledger = {
      listReadyWork: jest.fn(async () => ({
        items: [
          wrongRevisionRow,
          staleHeadRow,
          staleCursorRow,
          staleGenerationRow,
          mismatchedPlanRow,
          exactRow,
        ],
      })),
      rebuildRun: jest.fn(async (/** @type {string} */ candidateRunId) =>
        makeWorkflowView({
          ...harness,
          runId: candidateRunId,
          planId:
            candidateRunId === mismatchedPlanRunId
              ? `${planId.slice(0, -1)}${planId.endsWith('A') ? 'B' : 'A'}`
              : planId,
        }),
      ),
      repairReadyWork,
    };
    const runActivity = jest.fn();
    const recoverActivity = jest.fn();
    const recoverWorkflowActivity = jest.fn();
    const runWorkflowActivity = jest.fn(
      async (/** @type {RunWorkflowActivityOptions} */ _options) => {
        controller.abort();
        return { outcome: { dispatched: true } };
      },
    );

    await expect(
      runResidentActivityWorker({
        ledger: asExecutionLedger(ledger),
        execution,
        controlContext: harness.controlContext,
        owner: harness.owner,
        signal: controller.signal,
        runActivity: asRunActivity(runActivity),
        runWorkflowActivity: asRunWorkflowActivity(runWorkflowActivity),
        recoverActivity: asRecoverActivity(recoverActivity),
        recoverWorkflowActivity: asRecoverWorkflowActivity(
          recoverWorkflowActivity,
        ),
        createCommandServer: harness.createCommandServer,
      }),
    ).resolves.toEqual({ processed: 1 });

    expect(ledger.rebuildRun.mock.calls.map(([id]) => id)).toEqual([
      staleHeadRunId,
      staleCursorRunId,
      staleGenerationRunId,
      mismatchedPlanRunId,
      exactRunId,
    ]);
    expect(repairReadyWork.mock.calls.map(([request]) => request)).toEqual([
      {
        appId: harness.appId,
        revisionId: harness.revisionId,
        runId: staleHeadRunId,
        observed: staleHeadRow,
      },
      {
        appId: harness.appId,
        revisionId: harness.revisionId,
        runId: staleCursorRunId,
        observed: staleCursorRow,
      },
      {
        appId: harness.appId,
        revisionId: harness.revisionId,
        runId: staleGenerationRunId,
        observed: staleGenerationRow,
      },
    ]);
    expect(runWorkflowActivity).toHaveBeenCalledTimes(1);
    expect(runWorkflowActivity).toHaveBeenCalledWith(
      expect.objectContaining({ runId: exactRunId }),
    );
    expect(runActivity).not.toHaveBeenCalled();
    expect(recoverActivity).not.toHaveBeenCalled();
    expect(recoverWorkflowActivity).not.toHaveBeenCalled();
  });

  it('releases a claimed workflow attempt before dispatching its fresh generation', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const planId = workflowPlanId(execution);
    const runId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'recover-claimed-workflow',
    });
    const recoveryRow = makeWorkflowRow({
      ...harness,
      runId,
      kind: 'RECOVERY',
      generation: 1,
      version: 2,
      lastSequence: 2,
      cursorVersion: 2,
      availableAt: 10,
    });
    let view = makeWorkflowView({
      ...harness,
      runId,
      planId,
      invocationStatus: InvocationStatus.RUNNING,
      attemptStatus: AttemptStatus.CLAIMED,
      generation: 1,
      version: 2,
      lastSequence: 2,
      cursorVersion: 2,
      availableAt: 10,
    });
    const ledger = {
      listReadyWork: jest.fn(async () => ({ items: [recoveryRow] })),
      rebuildRun: jest.fn(async () => view),
    };
    /** @type {string[]} */
    const order = [];
    const recoverWorkflowActivity = jest.fn(
      async (
        /** @type {Parameters<RecoverWorkflowActivity>[0]} */ _options,
      ) => {
        order.push('release');
        view = makeWorkflowView({
          ...harness,
          runId,
          planId,
          invocationStatus: InvocationStatus.RUNNABLE,
          attemptStatus: AttemptStatus.ABANDONED,
          generation: 1,
          version: 3,
          lastSequence: 3,
          cursorVersion: 3,
          availableAt: 11,
        });
      },
    );
    const runWorkflowActivity = jest.fn(
      async (/** @type {RunWorkflowActivityOptions} */ _options) => {
        order.push('dispatch');
        controller.abort();
        return { outcome: { dispatched: true } };
      },
    );
    const runActivity = jest.fn();
    const recoverActivity = jest.fn();

    await expect(
      runResidentActivityWorker({
        ledger: asExecutionLedger(ledger),
        execution,
        controlContext: harness.controlContext,
        owner: harness.owner,
        signal: controller.signal,
        runActivity: asRunActivity(runActivity),
        runWorkflowActivity: asRunWorkflowActivity(runWorkflowActivity),
        recoverActivity: asRecoverActivity(recoverActivity),
        recoverWorkflowActivity: asRecoverWorkflowActivity(
          recoverWorkflowActivity,
        ),
        createCommandServer: harness.createCommandServer,
      }),
    ).resolves.toEqual({ processed: 1 });

    expect(order).toEqual(['release', 'dispatch']);
    expect(recoverWorkflowActivity).toHaveBeenCalledWith({
      ledger: asExecutionLedger(ledger),
      runId,
      invocationId: WORKFLOW_INVOCATION_ID,
      actor: { kind: 'resident-workflow-recovery', id: harness.appId },
    });
    expect(ledger.rebuildRun).toHaveBeenCalledTimes(2);
    expect(runWorkflowActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        invocationId: WORKFLOW_INVOCATION_ID,
        generation: 1,
        cursor: {
          version: 3,
          continuationId: WORKFLOW_CONTINUATION_ID,
          stepId: WORKFLOW_STEP_ID,
          stepIndex: 0,
        },
      }),
    );
    expect(runActivity).not.toHaveBeenCalled();
    expect(recoverActivity).not.toHaveBeenCalled();
  });

  it('does not dispatch an inconsistent workflow authority returned after recovery', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const planId = workflowPlanId(execution);
    const runId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'reject-inconsistent-recovered-workflow',
    });
    const recoveryRow = makeWorkflowRow({
      ...harness,
      runId,
      kind: 'RECOVERY',
      generation: 1,
      version: 2,
      lastSequence: 2,
      cursorVersion: 2,
      availableAt: 10,
    });
    let view = makeWorkflowView({
      ...harness,
      runId,
      planId,
      invocationStatus: InvocationStatus.RUNNING,
      attemptStatus: AttemptStatus.CLAIMED,
      generation: 1,
      version: 2,
      lastSequence: 2,
      cursorVersion: 2,
      availableAt: 10,
    });
    let listCalls = 0;
    const ledger = {
      listReadyWork: jest.fn(async () => {
        listCalls += 1;
        if (listCalls === 1) return { items: [recoveryRow] };
        controller.abort();
        return { items: [] };
      }),
      rebuildRun: jest.fn(async () => view),
    };
    const recoverWorkflowActivity = jest.fn(async () => {
      view = makeWorkflowView({
        ...harness,
        runId,
        planId,
        invocationStatus: InvocationStatus.RUNNABLE,
        attemptStatus: AttemptStatus.ABANDONED,
        generation: 1,
        version: 3,
        lastSequence: 3,
        cursorVersion: 3,
        availableAt: 11,
      });
      view.invocations[0].workflow.continuationId = 'inconsistent-continuation';
    });
    const runWorkflowActivity = jest.fn();

    await expect(
      runResidentActivityWorker({
        ledger: asExecutionLedger(ledger),
        execution,
        controlContext: harness.controlContext,
        owner: harness.owner,
        signal: controller.signal,
        pollIntervalMs: 1,
        runActivity: asRunActivity(jest.fn()),
        runWorkflowActivity: asRunWorkflowActivity(runWorkflowActivity),
        recoverActivity: asRecoverActivity(jest.fn()),
        recoverWorkflowActivity: asRecoverWorkflowActivity(
          recoverWorkflowActivity,
        ),
        createCommandServer: harness.createCommandServer,
      }),
    ).resolves.toEqual({ processed: 0 });

    expect(recoverWorkflowActivity).toHaveBeenCalledTimes(1);
    expect(ledger.rebuildRun).toHaveBeenCalledTimes(2);
    expect(runWorkflowActivity).not.toHaveBeenCalled();
  });

  it.each([
    ['matching manifest', true],
    ['mismatched manifest', false],
  ])(
    'blocks a recovered started workflow attempt with a %s without redispatch',
    async (_label, manifestMatches) => {
      const execution = makeEmbeddedExecution();
      const harness = makeHarness(execution);
      const controller = new AbortController();
      const exactPlanId = workflowPlanId(execution);
      const planId = manifestMatches
        ? exactPlanId
        : `${exactPlanId.slice(0, -1)}${exactPlanId.endsWith('A') ? 'B' : 'A'}`;
      const runId = createManualLedgerRunId({
        appId: harness.appId,
        idempotencyKey: 'recover-started-workflow',
      });
      const recoveryRow = makeWorkflowRow({
        ...harness,
        runId,
        kind: 'RECOVERY',
        generation: 1,
        version: 2,
        lastSequence: 2,
        cursorVersion: 2,
        availableAt: 10,
      });
      let view = makeWorkflowView({
        ...harness,
        runId,
        planId,
        invocationStatus: InvocationStatus.RUNNING,
        attemptStatus: AttemptStatus.STARTED,
        generation: 1,
        version: 2,
        lastSequence: 2,
        cursorVersion: 2,
        availableAt: 10,
      });
      const ledger = {
        listReadyWork: jest.fn(async () => ({ items: [recoveryRow] })),
        rebuildRun: jest.fn(async () => view),
      };
      const recoverWorkflowActivity = jest.fn(async () => {
        view = makeWorkflowView({
          ...harness,
          runId,
          planId,
          runStatus: RunStatus.BLOCKED,
          invocationStatus: InvocationStatus.UNCERTAIN,
          cursorDisposition: WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
          attemptStatus: AttemptStatus.ABANDONED,
          generation: 1,
          version: 3,
          lastSequence: 3,
          cursorVersion: 3,
          availableAt: 11,
        });
        controller.abort();
      });
      const runWorkflowActivity = jest.fn();
      const runActivity = jest.fn();
      const recoverActivity = jest.fn();

      await expect(
        runResidentActivityWorker({
          ledger: asExecutionLedger(ledger),
          execution,
          controlContext: harness.controlContext,
          owner: harness.owner,
          signal: controller.signal,
          runActivity: asRunActivity(runActivity),
          runWorkflowActivity: asRunWorkflowActivity(runWorkflowActivity),
          recoverActivity: asRecoverActivity(recoverActivity),
          recoverWorkflowActivity: asRecoverWorkflowActivity(
            recoverWorkflowActivity,
          ),
          createCommandServer: harness.createCommandServer,
        }),
      ).resolves.toEqual({ processed: 0 });

      expect(recoverWorkflowActivity).toHaveBeenCalledTimes(1);
      expect(ledger.rebuildRun).toHaveBeenCalledTimes(2);
      expect(runWorkflowActivity).not.toHaveBeenCalled();
      expect(runActivity).not.toHaveBeenCalled();
      expect(recoverActivity).not.toHaveBeenCalled();
    },
  );

  it('admits workflow drain immediately but delays physical cancellation without a manual registrar', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const drainTimeoutMs = 10;
    const planId = workflowPlanId(execution);
    const runId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'workflow-bounded-drain',
    });
    const ledger = {
      listReadyWork: jest.fn(async () => ({
        items: [makeWorkflowRow({ ...harness, runId })],
      })),
      rebuildRun: jest.fn(async () =>
        makeWorkflowView({ ...harness, runId, planId }),
      ),
    };
    /** @type {Deferred<unknown>} */
    const physicalAbort = deferred();
    /** @type {RunWorkflowActivityOptions | undefined} */
    let workflowRequest;
    const runWorkflowActivity = jest.fn(
      async (/** @type {RunWorkflowActivityOptions} */ options) => {
        workflowRequest = options;
        if (!options.signal) {
          throw new Error('Expected resident workflow attempt signal.');
        }
        if (!options.signal.aborted) {
          await new Promise((resolve) =>
            options.signal?.addEventListener('abort', resolve, { once: true }),
          );
        }
        physicalAbort.resolve(options.signal.reason);
        return { outcome: { dispatched: false } };
      },
    );
    const runActivity = jest.fn();
    const running = runResidentActivityWorker({
      ledger: asExecutionLedger(ledger),
      execution,
      controlContext: harness.controlContext,
      owner: harness.owner,
      signal: controller.signal,
      drainTimeoutMs,
      runActivity: asRunActivity(runActivity),
      runWorkflowActivity: asRunWorkflowActivity(runWorkflowActivity),
      recoverActivity: asRecoverActivity(jest.fn()),
      recoverWorkflowActivity: asRecoverWorkflowActivity(jest.fn()),
      createCommandServer: harness.createCommandServer,
    });
    await waitUntil(() => runWorkflowActivity.mock.calls.length === 1);

    if (!workflowRequest) {
      throw new Error('Expected resident workflow request.');
    }
    expect(workflowRequest.admissionSignal).toBe(controller.signal);
    expect(workflowRequest.admissionSignal?.aborted).toBe(false);
    expect(workflowRequest.signal?.aborted).toBe(false);
    expect(workflowRequest).not.toHaveProperty(
      'registerActiveAttemptCancellationPort',
    );
    expect(workflowRequest).not.toHaveProperty('ownerCancellation');
    expect(workflowRequest).not.toHaveProperty('controlContext');

    controller.abort(new Error('resident workflow shutdown'));
    expect(workflowRequest.admissionSignal?.aborted).toBe(true);
    expect(workflowRequest.signal?.aborted).toBe(false);

    await expect(physicalAbort.promise).resolves.toMatchObject({
      name: 'ResidentWorkerDrainExpired',
      code: 'resident-worker-drain-expired',
      details: { runId, drainTimeoutMs },
    });
    await expect(running).resolves.toEqual({ processed: 1 });
    expect(workflowRequest.signal?.aborted).toBe(true);
    expect(runActivity).not.toHaveBeenCalled();
  });

  it('does not dispatch a locator returned after shutdown begins', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const runId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'shutdown-during-ready-work-read',
    });
    /** @type {Deferred<{items: Record<string, any>[]}>} */
    const pendingPage = deferred();
    const ledger = {
      listReadyWork: jest.fn(async () => await pendingPage.promise),
      rebuildRun: jest.fn(async () => makeView({ ...harness, runId })),
    };
    const runActivity = jest.fn();
    const running = runResidentActivityWorker({
      ledger: asExecutionLedger(ledger),
      execution,
      controlContext: harness.controlContext,
      owner: harness.owner,
      signal: controller.signal,
      runActivity: asRunActivity(runActivity),
      recoverActivity: asRecoverActivity(jest.fn()),
      createCommandServer: harness.createCommandServer,
    });
    await waitUntil(() => ledger.listReadyWork.mock.calls.length === 1);

    controller.abort();
    pendingPage.resolve({
      items: [makeRow({ ...harness, runId })],
    });

    await expect(running).resolves.toEqual({ processed: 0 });
    expect(runActivity).not.toHaveBeenCalled();
  });

  it('does not recover a stale attempt whose rebuild finishes after shutdown begins', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const runId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'shutdown-during-rebuild',
    });
    /** @type {Deferred<Record<string, any>>} */
    const pendingView = deferred();
    const ledger = {
      listReadyWork: jest.fn(async () => ({
        items: [makeRow({ ...harness, runId, kind: 'RECOVERY' })],
      })),
      rebuildRun: jest.fn(async () => await pendingView.promise),
    };
    const recoverActivity = jest.fn();
    const runActivity = jest.fn();
    const running = runResidentActivityWorker({
      ledger: asExecutionLedger(ledger),
      execution,
      controlContext: harness.controlContext,
      owner: harness.owner,
      signal: controller.signal,
      runActivity: asRunActivity(runActivity),
      recoverActivity: asRecoverActivity(recoverActivity),
      createCommandServer: harness.createCommandServer,
    });
    await waitUntil(() => ledger.rebuildRun.mock.calls.length === 1);

    controller.abort();
    pendingView.resolve(
      makeView({
        ...harness,
        runId,
        invocationStatus: InvocationStatus.RUNNING,
        attemptStatus: AttemptStatus.CLAIMED,
      }),
    );

    await expect(running).resolves.toEqual({ processed: 0 });
    expect(recoverActivity).not.toHaveBeenCalled();
    expect(runActivity).not.toHaveBeenCalled();
  });

  it('publishes readiness only after binding the enlarged resident command endpoint', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const ledger = {
      listReadyWork: jest.fn(async () => ({ items: [] })),
      rebuildRun: jest.fn(),
    };
    const onReady = jest.fn(async () => {
      expect(harness.getCommandServerOptions()).toEqual(
        expect.objectContaining({
          timeoutMs: LOCAL_OWNER_COMMAND_MAX_TIMEOUT_MS,
          maxRequestBytes: LOCAL_OWNER_COMMAND_MAX_REQUEST_BYTES,
        }),
      );
      controller.abort();
    });

    await expect(
      runResidentActivityWorker({
        ledger: asExecutionLedger(ledger),
        execution,
        controlContext: harness.controlContext,
        owner: harness.owner,
        signal: controller.signal,
        runActivity: asRunActivity(jest.fn()),
        recoverActivity: asRecoverActivity(jest.fn()),
        createCommandServer: harness.createCommandServer,
        onReady,
      }),
    ).resolves.toEqual({ processed: 0 });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it('recovers a stale claimed attempt before dispatch', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const runId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'recover-claimed',
    });
    let view = makeView({
      ...harness,
      runId,
      invocationStatus: InvocationStatus.RUNNING,
      attemptStatus: AttemptStatus.CLAIMED,
    });
    const ledger = {
      listReadyWork: jest.fn(async () => ({
        items: [makeRow({ ...harness, runId, kind: 'RECOVERY' })],
      })),
      rebuildRun: jest.fn(async () => view),
    };
    /** @type {string[]} */
    const order = [];
    const recoverActivity = jest.fn(
      async (/** @type {Parameters<RecoverActivity>[0]} */ _options) => {
        order.push('recover');
        view = makeView({ ...harness, runId, generation: 1 });
      },
    );
    const runActivity = jest.fn(
      async (/** @type {RunActivityOptions} */ _options) => {
        order.push('dispatch');
        controller.abort();
      },
    );

    await expect(
      runResidentActivityWorker({
        ledger: asExecutionLedger(ledger),
        execution,
        controlContext: harness.controlContext,
        owner: harness.owner,
        signal: controller.signal,
        runActivity: asRunActivity(runActivity),
        recoverActivity: asRecoverActivity(recoverActivity),
        createCommandServer: harness.createCommandServer,
      }),
    ).resolves.toEqual({ processed: 1 });

    expect(order).toEqual(['recover', 'dispatch']);
    expect(recoverActivity).toHaveBeenCalledWith({
      ledger: asExecutionLedger(ledger),
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      actor: { kind: 'resident-recovery', id: harness.appId },
    });
    expect(ledger.rebuildRun).toHaveBeenCalledTimes(2);
    expect(runActivity).toHaveBeenCalledWith(
      expect.objectContaining({ runId }),
    );
  });

  it('does not dispatch inconsistent manual authority returned after recovery', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const runId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'reject-inconsistent-recovered-manual',
    });
    let view = makeView({
      ...harness,
      runId,
      invocationStatus: InvocationStatus.RUNNING,
      attemptStatus: AttemptStatus.CLAIMED,
    });
    let listCalls = 0;
    const ledger = {
      listReadyWork: jest.fn(async () => {
        listCalls += 1;
        if (listCalls === 1) {
          return {
            items: [makeRow({ ...harness, runId, kind: 'RECOVERY' })],
          };
        }
        controller.abort();
        return { items: [] };
      }),
      rebuildRun: jest.fn(async () => view),
    };
    const recoverActivity = jest.fn(async () => {
      view = makeView({ ...harness, runId, generation: 1 });
      view.invocations[0].runId = 'different-run-authority';
    });
    const runActivity = jest.fn();

    await expect(
      runResidentActivityWorker({
        ledger: asExecutionLedger(ledger),
        execution,
        controlContext: harness.controlContext,
        owner: harness.owner,
        signal: controller.signal,
        pollIntervalMs: 1,
        runActivity: asRunActivity(runActivity),
        recoverActivity: asRecoverActivity(recoverActivity),
        createCommandServer: harness.createCommandServer,
      }),
    ).resolves.toEqual({ processed: 0 });

    expect(recoverActivity).toHaveBeenCalledTimes(1);
    expect(ledger.rebuildRun).toHaveBeenCalledTimes(2);
    expect(runActivity).not.toHaveBeenCalled();
  });

  it('recovers stale started work to uncertainty without redispatch', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const runId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'recover-started',
    });
    let view = makeView({
      ...harness,
      runId,
      invocationStatus: InvocationStatus.RUNNING,
      attemptStatus: AttemptStatus.STARTED,
    });
    const ledger = {
      listReadyWork: jest.fn(async () => ({
        items: [makeRow({ ...harness, runId, kind: 'RECOVERY' })],
      })),
      rebuildRun: jest.fn(async () => view),
    };
    const recoverActivity = jest.fn(async () => {
      view = makeView({
        ...harness,
        runId,
        runStatus: RunStatus.BLOCKED,
        invocationStatus: InvocationStatus.UNCERTAIN,
        attemptStatus: AttemptStatus.STARTED,
      });
      controller.abort();
    });
    const runActivity = jest.fn();

    await expect(
      runResidentActivityWorker({
        ledger: asExecutionLedger(ledger),
        execution,
        controlContext: harness.controlContext,
        owner: harness.owner,
        signal: controller.signal,
        runActivity: asRunActivity(runActivity),
        recoverActivity: asRecoverActivity(recoverActivity),
        createCommandServer: harness.createCommandServer,
      }),
    ).resolves.toEqual({ processed: 0 });

    expect(recoverActivity).toHaveBeenCalledTimes(1);
    expect(ledger.rebuildRun).toHaveBeenCalledTimes(2);
    expect(runActivity).not.toHaveBeenCalled();
  });

  it('settles stale managed effects atomically without killing the resident worker', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const runId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'recover-started-managed-effects',
    });
    const effects = [
      {
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        effectId: 'resident-started-effect',
        status: EffectStatus.STARTED,
        requestedBy: { attemptId: 'resident-attempt-1' },
      },
    ];
    let view = makeView({
      ...harness,
      runId,
      invocationStatus: InvocationStatus.RUNNING,
      attemptStatus: AttemptStatus.STARTED,
      effects,
    });
    const ledger = {
      listReadyWork: jest.fn(async () => ({
        items: [makeRow({ ...harness, runId, kind: 'RECOVERY' })],
      })),
      rebuildRun: jest.fn(async () => view),
    };
    const recoverActivity = jest.fn();
    const recoverManagedEffects = jest.fn(
      async (/** @type {Record<string, any>} */ _options) => {
        view = makeView({
          ...harness,
          runId,
          runStatus: RunStatus.BLOCKED,
          invocationStatus: InvocationStatus.UNCERTAIN,
          attemptStatus: AttemptStatus.STARTED,
          effects,
        });
        controller.abort();
        return { action: 'settled-managed-effect-set', changed: true };
      },
    );
    const runActivity = jest.fn();

    await expect(
      runResidentActivityWorker({
        ledger: asExecutionLedger(ledger),
        execution,
        controlContext: harness.controlContext,
        owner: harness.owner,
        signal: controller.signal,
        runActivity: asRunActivity(runActivity),
        recoverActivity: asRecoverActivity(recoverActivity),
        recoverManagedEffects,
        createCommandServer: harness.createCommandServer,
      }),
    ).resolves.toEqual({ processed: 0 });

    expect(recoverManagedEffects).toHaveBeenCalledWith({
      ledger: asExecutionLedger(ledger),
      appId: harness.appId,
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      attemptId: 'resident-attempt-1',
      attempt: {
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        attemptId: 'resident-attempt-1',
        fencingToken: 'resident-fence-1',
        generation: 1,
        status: AttemptStatus.STARTED,
        updatedAt: 0,
      },
      effects,
      actor: { kind: 'resident-recovery', id: harness.appId },
      controlContext: harness.controlContext,
    });
    expect(recoverActivity).not.toHaveBeenCalled();
    expect(ledger.rebuildRun).toHaveBeenCalledTimes(2);
    expect(runActivity).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched authenticated submissions before mutation', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const ledger = {
      listReadyWork: jest.fn(async () => ({ items: [] })),
      rebuildRun: jest.fn(),
    };
    const submitActivity = jest.fn();
    const running = runResidentActivityWorker({
      ledger: asExecutionLedger(ledger),
      execution,
      controlContext: harness.controlContext,
      owner: harness.owner,
      signal: controller.signal,
      pollIntervalMs: 10_000,
      runActivity: asRunActivity(jest.fn()),
      submitActivity: asSubmitActivity(submitActivity),
      recoverActivity: asRecoverActivity(jest.fn()),
      createCommandServer: harness.createCommandServer,
    });
    await waitUntil(() => harness.getCommandServerOptions() !== undefined);
    const { handleCommand } = harness.getCommandServerOptions();
    const request = {
      appId: harness.appId,
      revisionId: harness.revisionId,
      activityName: 'greet',
      idempotencyKey: 'mismatched-submit',
    };

    await expect(
      handleCommand(
        {
          requestId: 'mismatched-app-request',
          command: RESIDENT_ACTIVITY_SUBMIT_COMMAND,
          request: { ...request, appId: `${harness.appId}-other` },
        },
        {},
      ),
    ).rejects.toThrow(
      'Resident activity submission does not match the owned application revision.',
    );
    await expect(
      handleCommand(
        {
          requestId: 'mismatched-revision-request',
          command: RESIDENT_ACTIVITY_SUBMIT_COMMAND,
          request: { ...request, revisionId: `${harness.revisionId}-other` },
        },
        {},
      ),
    ).rejects.toThrow(
      'Resident activity submission does not match the owned application revision.',
    );

    expect(submitActivity).not.toHaveBeenCalled();
    controller.abort();
    await expect(running).resolves.toEqual({ processed: 0 });
  });

  it('starts an exact authenticated workflow and wakes idle dispatch', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const idempotencyKey = 'resident-workflow-start';
    const runId = createWorkflowRunId({
      appId: harness.appId,
      idempotencyKey,
    });
    const planId = workflowPlanId(execution);
    let started = false;
    const ledger = {
      listReadyWork: jest.fn(async () => ({
        items: started ? [makeWorkflowRow({ ...harness, runId })] : [],
      })),
      rebuildRun: jest.fn(async () =>
        started ? makeWorkflowView({ ...harness, runId, planId }) : null,
      ),
    };
    const accepted = Object.freeze({ accepted: true, runId });
    const startWorkflow = jest.fn(
      async (/** @type {Parameters<StartWorkflow>[0]} */ _options) => {
        started = true;
        return accepted;
      },
    );
    const runWorkflowActivity = jest.fn(
      async (/** @type {RunWorkflowActivityOptions} */ _options) => {
        controller.abort();
      },
    );
    const running = runResidentActivityWorker({
      ledger: asExecutionLedger(ledger),
      execution,
      controlContext: harness.controlContext,
      owner: harness.owner,
      signal: controller.signal,
      pollIntervalMs: 10_000,
      runActivity: asRunActivity(jest.fn()),
      runWorkflowActivity: asRunWorkflowActivity(runWorkflowActivity),
      startWorkflow: asStartWorkflow(startWorkflow),
      recoverActivity: asRecoverActivity(jest.fn()),
      createCommandServer: harness.createCommandServer,
    });
    await waitUntil(() => ledger.listReadyWork.mock.calls.length === 1);
    const { handleCommand } = harness.getCommandServerOptions();
    const response = await handleCommand(
      {
        requestId: runId,
        command: RESIDENT_WORKFLOW_START_COMMAND,
        request: {
          appId: harness.appId,
          revisionId: harness.revisionId,
          workflowId: WORKFLOW_ID,
          idempotencyKey,
          input: { name: 'Ada' },
          callerMetadata: { requestId: 'workflow-start-request' },
          actor: { kind: 'workflow-operator', id: harness.revisionId },
        },
      },
      {},
    );

    expect(response).toBe(accepted);
    await expect(running).resolves.toEqual({ processed: 1 });
    expect(startWorkflow).toHaveBeenCalledWith({
      ledger: asExecutionLedger(ledger),
      execution: expect.objectContaining({ kind: 'embedded' }),
      workflowId: WORKFLOW_ID,
      idempotencyKey,
      input: { name: 'Ada' },
      callerMetadata: { requestId: 'workflow-start-request' },
      actor: { kind: 'workflow-operator', id: harness.revisionId },
    });
    expect(ledger.listReadyWork).toHaveBeenCalledTimes(2);
    expect(runWorkflowActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        workflowId: WORKFLOW_ID,
        planId,
      }),
    );
  });

  it('rejects mismatched or expanded workflow starts before mutation', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const ledger = {
      listReadyWork: jest.fn(async () => ({ items: [] })),
      rebuildRun: jest.fn(),
    };
    const startWorkflow = jest.fn();
    const running = runResidentActivityWorker({
      ledger: asExecutionLedger(ledger),
      execution,
      controlContext: harness.controlContext,
      owner: harness.owner,
      signal: controller.signal,
      pollIntervalMs: 10_000,
      runActivity: asRunActivity(jest.fn()),
      startWorkflow: asStartWorkflow(startWorkflow),
      recoverActivity: asRecoverActivity(jest.fn()),
      createCommandServer: harness.createCommandServer,
    });
    await waitUntil(() => harness.getCommandServerOptions() !== undefined);
    const { handleCommand } = harness.getCommandServerOptions();
    const request = {
      appId: harness.appId,
      revisionId: harness.revisionId,
      workflowId: WORKFLOW_ID,
      idempotencyKey: 'rejected-workflow-start',
    };

    await expect(
      handleCommand(
        {
          requestId: 'mismatched-workflow-app',
          command: RESIDENT_WORKFLOW_START_COMMAND,
          request: { ...request, appId: `${harness.appId}-other` },
        },
        {},
      ),
    ).rejects.toThrow(
      'Resident workflow start does not match the owned application revision.',
    );
    await expect(
      handleCommand(
        {
          requestId: 'mismatched-workflow-revision',
          command: RESIDENT_WORKFLOW_START_COMMAND,
          request: { ...request, revisionId: `${harness.revisionId}-other` },
        },
        {},
      ),
    ).rejects.toThrow(
      'Resident workflow start does not match the owned application revision.',
    );
    await expect(
      handleCommand(
        {
          requestId: 'expanded-workflow-request',
          command: RESIDENT_WORKFLOW_START_COMMAND,
          request: {
            ...request,
            definition: execution.manifest.workflows[WORKFLOW_ID],
          },
        },
        {},
      ),
    ).rejects.toThrow('Resident workflow start.definition is unsupported.');

    expect(startWorkflow).not.toHaveBeenCalled();
    controller.abort();
    await expect(running).resolves.toEqual({ processed: 0 });
  });

  it('stops admitting workflow starts and waits for an admitted start', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const ledger = {
      listReadyWork: jest.fn(async () => ({ items: [] })),
      rebuildRun: jest.fn(),
    };
    /** @type {Deferred<Record<string, any>>} */
    const pendingStart = deferred();
    const startWorkflow = jest.fn(async () => await pendingStart.promise);
    let workerSettled = false;
    const running = runResidentActivityWorker({
      ledger: asExecutionLedger(ledger),
      execution,
      controlContext: harness.controlContext,
      owner: harness.owner,
      signal: controller.signal,
      pollIntervalMs: 10_000,
      runActivity: asRunActivity(jest.fn()),
      startWorkflow: asStartWorkflow(startWorkflow),
      recoverActivity: asRecoverActivity(jest.fn()),
      createCommandServer: harness.createCommandServer,
    });
    running.then(
      () => {
        workerSettled = true;
      },
      () => {
        workerSettled = true;
      },
    );
    await waitUntil(() => harness.getCommandServerOptions() !== undefined);
    const { handleCommand } = harness.getCommandServerOptions();
    const request = {
      appId: harness.appId,
      revisionId: harness.revisionId,
      workflowId: WORKFLOW_ID,
      idempotencyKey: 'in-flight-workflow-start',
    };
    const admitted = handleCommand(
      {
        requestId: 'in-flight-workflow-start-request',
        command: RESIDENT_WORKFLOW_START_COMMAND,
        request,
      },
      {},
    );
    await waitUntil(() => startWorkflow.mock.calls.length === 1);

    controller.abort();
    await expect(
      handleCommand(
        {
          requestId: 'late-workflow-start-request',
          command: RESIDENT_WORKFLOW_START_COMMAND,
          request: { ...request, idempotencyKey: 'too-late' },
        },
        {},
      ),
    ).resolves.toEqual({
      outcome: 'request-unavailable',
      delivery: 'not-delivered',
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(workerSettled).toBe(false);
    expect(harness.close).not.toHaveBeenCalled();

    const accepted = { accepted: true, runId: 'started-workflow-run' };
    pendingStart.resolve(accepted);
    await expect(admitted).resolves.toBe(accepted);
    await expect(running).resolves.toEqual({ processed: 0 });
    expect(startWorkflow).toHaveBeenCalledTimes(1);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it('stops commands, bounds attempt drain, and waits for in-flight submits', async () => {
    const execution = makeEmbeddedExecution();
    const harness = makeHarness(execution);
    const controller = new AbortController();
    const drainTimeoutMs = 10;
    const runId = createManualLedgerRunId({
      appId: harness.appId,
      idempotencyKey: 'bounded-drain',
    });
    const ledger = {
      listReadyWork: jest.fn(async () => ({
        items: [makeRow({ ...harness, runId })],
      })),
      rebuildRun: jest.fn(async () => makeView({ ...harness, runId })),
    };
    /** @type {Deferred<Record<string, any>>} */
    const pendingSubmit = deferred();
    const submitActivity = jest.fn(async () => await pendingSubmit.promise);
    /** @type {Deferred<unknown>} */
    const attemptAborted = deferred();
    /** @type {AbortSignal | undefined} */
    let attemptSignal;
    const runActivity = jest.fn(
      async (/** @type {RunActivityOptions} */ { signal }) => {
        if (!signal) throw new Error('Expected resident attempt signal.');
        attemptSignal = signal;
        if (!signal.aborted) {
          await new Promise((resolve) =>
            signal.addEventListener('abort', resolve, { once: true }),
          );
        }
        attemptAborted.resolve(signal.reason);
      },
    );
    let workerSettled = false;
    const running = runResidentActivityWorker({
      ledger: asExecutionLedger(ledger),
      execution,
      controlContext: harness.controlContext,
      owner: harness.owner,
      signal: controller.signal,
      drainTimeoutMs,
      runActivity: asRunActivity(runActivity),
      submitActivity: asSubmitActivity(submitActivity),
      recoverActivity: asRecoverActivity(jest.fn()),
      createCommandServer: harness.createCommandServer,
    });
    running.then(
      () => {
        workerSettled = true;
      },
      () => {
        workerSettled = true;
      },
    );
    await waitUntil(
      () =>
        runActivity.mock.calls.length === 1 &&
        harness.getCommandServerOptions() !== undefined,
    );
    const { handleCommand } = harness.getCommandServerOptions();
    const submission = handleCommand(
      {
        requestId: 'in-flight-submit-request',
        command: RESIDENT_ACTIVITY_SUBMIT_COMMAND,
        request: {
          appId: harness.appId,
          revisionId: harness.revisionId,
          activityName: 'greet',
          idempotencyKey: 'submitted-during-attempt',
          input: { name: 'Ada' },
        },
      },
      {},
    );
    await waitUntil(() => submitActivity.mock.calls.length === 1);

    controller.abort();
    await expect(
      handleCommand(
        {
          requestId: 'late-submit-request',
          command: RESIDENT_ACTIVITY_SUBMIT_COMMAND,
          request: {
            appId: harness.appId,
            revisionId: harness.revisionId,
            activityName: 'greet',
            idempotencyKey: 'too-late',
          },
        },
        {},
      ),
    ).resolves.toEqual({
      outcome: 'request-unavailable',
      delivery: 'not-delivered',
    });

    await expect(attemptAborted.promise).resolves.toMatchObject({
      name: 'ResidentWorkerDrainExpired',
      code: 'resident-worker-drain-expired',
      details: { runId, drainTimeoutMs },
    });
    expect(attemptSignal?.aborted).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(workerSettled).toBe(false);
    expect(harness.close).not.toHaveBeenCalled();
    expect(submitActivity).toHaveBeenCalledTimes(1);

    const accepted = { outcome: 'accepted', runId: 'submitted-run' };
    pendingSubmit.resolve(accepted);
    await expect(submission).resolves.toBe(accepted);
    await expect(running).resolves.toEqual({ processed: 1 });
    expect(harness.close).toHaveBeenCalledTimes(1);
  });
});
