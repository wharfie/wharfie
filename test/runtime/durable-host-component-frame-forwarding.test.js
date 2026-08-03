/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const APP_RUNS_IMPORT = '../../src/core/runtime/app-runs.js';
const APPLICATION_STATE_STORE_IMPORT =
  '../../src/core/runtime/application-state-store.js';
const BUILTIN_EFFECT_CATALOG_IMPORT =
  '../../src/core/runtime/effects/builtin-catalog.js';
const MANUAL_LEDGER_RUN_IMPORT = '../../src/core/runtime/manual-ledger-run.js';
const WORKFLOW_LEDGER_RUN_IMPORT =
  '../../src/core/runtime/workflow-ledger-run.js';
const EXECUTION_LEDGER_STORE_IMPORT =
  '../../src/core/runtime/operator/execution-ledger-store.js';
const LOCAL_OWNER_COMMAND_IMPORT =
  '../../src/core/runtime/operator/local-owner-command.js';
const LEDGER_SERVICE_LIFECYCLE_IMPORT =
  '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
const EXECUTION_LEDGER_OPERATOR_IMPORT =
  '../../src/core/runtime/operator/execution-ledger-operator.js';
const DURABLE_ACTIVITY_HOST_IMPORT =
  '../../src/core/runtime/durable-activity-host.js';
const DURABLE_WORKFLOW_HOST_IMPORT =
  '../../src/core/runtime/durable-workflow-host.js';

const APP_ID = 'durable-host-bridge';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const ACTIVITY_ID = 'greet';
const WORKFLOW_ID = 'main';
const PLAN_DEFINITION = Object.freeze({
  steps: [
    Object.freeze({
      id: 'greet-step',
      kind: 'activity',
      activity: ACTIVITY_ID,
      input: { kind: 'workflow-input' },
    }),
  ],
});
const MANIFEST = Object.freeze({
  app: Object.freeze({ id: APP_ID }),
  activities: Object.freeze({ [ACTIVITY_ID]: Object.freeze({}) }),
  workflows: Object.freeze({ [WORKFLOW_ID]: PLAN_DEFINITION }),
});
const EXECUTION = Object.freeze({ kind: 'embedded-test-execution' });
const APPLICATION_STATE_CONFIGURATION = Object.freeze({
  adapterName: 'lmdb',
  storePath: '/private/tmp/wharfie-durable-host-bridge-application',
  tableName: 'wharfie-application-state-v2',
});
const CONTROL_CONTEXT = Object.freeze({
  db: Object.freeze({}),
  adapterName: 'lmdb',
  controlPath: '/private/tmp/wharfie-durable-host-bridge-control',
  tableName: 'wharfie-execution-ledger-v2',
});
const MANUAL_START = Object.freeze({
  protocol: 'wharfie.activity',
  protocolVersion: 1,
  type: 'start',
  revisionId: REVISION_ID,
  activityId: ACTIVITY_ID,
  runId: 'manual-run',
  invocationId: 'manual',
  attemptId: 'manual-attempt',
  fencingToken: 'manual-fence',
  input: { name: 'Ada' },
  caller: { metadata: {} },
});
const WORKFLOW_START = Object.freeze({
  ...MANUAL_START,
  runId: 'workflow-run',
  invocationId: 'workflow-invocation',
  attemptId: 'workflow-attempt',
  fencingToken: 'workflow-fence',
});
const MANUAL_LOG = Object.freeze({
  protocol: 'wharfie.activity',
  protocolVersion: 1,
  type: 'log',
  attemptId: MANUAL_START.attemptId,
  sequence: 1,
  level: 'info',
  message: 'manual host bridge',
  fields: { bridge: 'manual' },
});
const WORKFLOW_LOG = Object.freeze({
  ...MANUAL_LOG,
  attemptId: WORKFLOW_START.attemptId,
  message: 'workflow host bridge',
  fields: { bridge: 'workflow' },
});

const manualComponentSink = jest.fn(
  async (/** @type {Readonly<Record<string, any>>} */ _frame) => undefined,
);
const workflowComponentSink = jest.fn(
  async (/** @type {Readonly<Record<string, any>>} */ _frame) => undefined,
);
const closeApplicationState = jest.fn(async () => undefined);
const createBuiltinManagedEffectCatalog = jest.fn(async () => ({}));
const createBuiltinManagedEffectHandler = jest.fn(() => async () => ({}));
const invokeManifestActivityAttemptWithStart = jest.fn(
  async (/** @type {Record<string, any>} */ options) => {
    const frame =
      options.startFrame.attemptId === MANUAL_START.attemptId
        ? MANUAL_LOG
        : WORKFLOW_LOG;
    await options.onComponentFrame(frame);
    return { status: 'completed', start: options.startFrame };
  },
);

jest.unstable_mockModule(APP_RUNS_IMPORT, () => ({
  getManifestActivityNames: () => [ACTIVITY_ID],
  getManifestWorkflowDefinition: (
    /** @type {{manifest: Record<string, any>, workflowName: string}} */ options,
  ) => options.manifest.workflows[options.workflowName],
  invokeManifestActivityAttemptWithStart,
  resolveManifestActivityExecutionBinding: (
    /** @type {Record<string, any>} */ execution,
  ) =>
    Object.freeze({
      execution,
      identity: Object.freeze({
        appId: APP_ID,
        revisionId: REVISION_ID,
        manifest: MANIFEST,
      }),
    }),
}));

jest.unstable_mockModule(APPLICATION_STATE_STORE_IMPORT, () => ({
  assertApplicationStateStoreIsolation: jest.fn(),
  openApplicationStateDB: jest.fn(async () => ({
    db: Object.freeze({}),
    context: APPLICATION_STATE_CONFIGURATION,
    close: closeApplicationState,
  })),
  resolveApplicationStateStoreConfiguration: () =>
    APPLICATION_STATE_CONFIGURATION,
  validateApplicationStateStoreConfiguration: () =>
    APPLICATION_STATE_CONFIGURATION,
}));

jest.unstable_mockModule(BUILTIN_EFFECT_CATALOG_IMPORT, () => ({
  createBuiltinManagedEffectCatalog,
  createBuiltinManagedEffectHandler,
}));

jest.unstable_mockModule(MANUAL_LEDGER_RUN_IMPORT, () => ({
  MANUAL_LEDGER_INVOCATION_ID: 'manual',
  createManualLedgerRunId: () => MANUAL_START.runId,
  runManualLedgerActivity: jest.fn(
    async (/** @type {Record<string, any>} */ options) => {
      const dispatch = await options.prepareAttemptDispatch();
      try {
        return await dispatch.executeAttempt(MANUAL_START, {
          signal: new AbortController().signal,
          onComponentFrame: manualComponentSink,
        });
      } finally {
        await dispatch.release();
      }
    },
  ),
  submitManualLedgerActivity: jest.fn(),
}));

jest.unstable_mockModule(WORKFLOW_LEDGER_RUN_IMPORT, () => ({
  runWorkflowLedgerActivity: jest.fn(
    async (/** @type {Record<string, any>} */ options) =>
      await options.executeAttempt(WORKFLOW_START, {
        signal: new AbortController().signal,
        onComponentFrame: workflowComponentSink,
      }),
  ),
}));

jest.unstable_mockModule(EXECUTION_LEDGER_STORE_IMPORT, () => ({
  resolveExecutionLedgerStoreConfiguration: jest.fn(),
  withExecutionLedger: jest.fn(),
  withLocalLedgerServiceMutationOwnership: jest.fn(),
}));

jest.unstable_mockModule(LOCAL_OWNER_COMMAND_IMPORT, () => ({
  createLocalOwnerCommandServer: jest.fn(),
}));

jest.unstable_mockModule(LEDGER_SERVICE_LIFECYCLE_IMPORT, () => ({
  createLedgerServiceOwnership: jest.fn(),
}));

jest.unstable_mockModule(EXECUTION_LEDGER_OPERATOR_IMPORT, () => ({
  EXECUTION_LEDGER_CANCEL_OWNER_COMMAND: 'cancel-owner',
}));

beforeEach(() => {
  manualComponentSink.mockClear();
  workflowComponentSink.mockClear();
  closeApplicationState.mockClear();
  createBuiltinManagedEffectCatalog.mockClear();
  createBuiltinManagedEffectHandler.mockClear();
  invokeManifestActivityAttemptWithStart.mockClear();
});

describe('durable host component-frame forwarding', () => {
  it('forwards the manual runner component sink through the durable activity host', async () => {
    const { runDurableManifestActivity } = await import(
      DURABLE_ACTIVITY_HOST_IMPORT
    );

    await runDurableManifestActivity({
      ledger: /** @type {any} */ ({}),
      controlContext: /** @type {any} */ (CONTROL_CONTEXT),
      applicationStateConfiguration: /** @type {any} */ (
        APPLICATION_STATE_CONFIGURATION
      ),
      execution: /** @type {any} */ (EXECUTION),
      activityName: ACTIVITY_ID,
      idempotencyKey: 'manual-host-bridge',
    });

    expect(invokeManifestActivityAttemptWithStart).toHaveBeenCalledTimes(1);
    expect(
      invokeManifestActivityAttemptWithStart.mock.calls[0][0].onComponentFrame,
    ).toBe(manualComponentSink);
    expect(manualComponentSink).toHaveBeenCalledWith(MANUAL_LOG);
    expect(workflowComponentSink).not.toHaveBeenCalled();
    expect(closeApplicationState).toHaveBeenCalledTimes(1);
  });

  it('forwards the workflow runner component sink through the durable workflow host', async () => {
    const { resolveManifestWorkflowStartBinding } = await import(
      DURABLE_WORKFLOW_HOST_IMPORT
    );
    const { runPersistedDurableManifestWorkflowActivity } = await import(
      DURABLE_WORKFLOW_HOST_IMPORT
    );
    const { planId } = resolveManifestWorkflowStartBinding({
      identity: {
        appId: APP_ID,
        revisionId: REVISION_ID,
        manifest: MANIFEST,
      },
      workflowId: WORKFLOW_ID,
    });

    await runPersistedDurableManifestWorkflowActivity({
      ledger: /** @type {any} */ ({}),
      execution: /** @type {any} */ (EXECUTION),
      runId: WORKFLOW_START.runId,
      workflowId: WORKFLOW_ID,
      planId,
      invocationId: WORKFLOW_START.invocationId,
      activityId: ACTIVITY_ID,
      generation: 0,
      cursor: {
        version: 1,
        continuationId: 'continuation-1',
        stepId: 'greet-step',
        stepIndex: 0,
      },
    });

    expect(invokeManifestActivityAttemptWithStart).toHaveBeenCalledTimes(1);
    expect(
      invokeManifestActivityAttemptWithStart.mock.calls[0][0].onComponentFrame,
    ).toBe(workflowComponentSink);
    expect(workflowComponentSink).toHaveBeenCalledWith(WORKFLOW_LOG);
    expect(manualComponentSink).not.toHaveBeenCalled();
    expect(closeApplicationState).not.toHaveBeenCalled();
  });
});
