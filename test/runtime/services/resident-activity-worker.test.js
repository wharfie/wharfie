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
  runResidentActivityWorker,
} from '../../../src/core/runtime/services/resident-activity-worker.js';

/** @typedef {import('../../../src/core/lib/db/base.js').DBClient} DBClient */
/** @typedef {import('../../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ExecutionLedgerStore */
/** @typedef {import('../../../src/core/runtime/durable-activity-host.js').ManifestActivityExecution} ManifestActivityExecution */
/** @typedef {Extract<ManifestActivityExecution, {kind: 'embedded'}>} EmbeddedExecution */
/** @typedef {typeof import('../../../src/core/runtime/durable-activity-host.js').runPersistedDurableManifestActivity} RunActivity */
/** @typedef {typeof import('../../../src/core/runtime/durable-activity-host.js').submitDurableManifestActivity} SubmitActivity */
/** @typedef {typeof import('../../../src/core/runtime/manual-ledger-run.js').recoverManualLedgerActivity} RecoverActivity */
/** @typedef {typeof import('../../../src/core/runtime/operator/local-owner-command.js').createLocalOwnerCommandServer} CommandServerFactory */
/** @typedef {Parameters<RunActivity>[0]} RunActivityOptions */
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
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        revisionId,
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

/** @param {unknown} mock @returns {SubmitActivity} */
function asSubmitActivity(mock) {
  return /** @type {SubmitActivity} */ (mock);
}

/** @param {unknown} mock @returns {RecoverActivity} */
function asRecoverActivity(mock) {
  return /** @type {RecoverActivity} */ (mock);
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
        view = makeView({ ...harness, runId });
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
