/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import * as coordinatorAuthorityModule from '../../src/core/lib/db/tables/coordinator-authority.js';

const {
  CoordinatorAuthorityConflictError,
  CoordinatorAuthorityStaleError,
  createCoordinatorAuthorityToken,
} = coordinatorAuthorityModule;

const APP_RUNS_IMPORT = '../../src/core/runtime/app-runs.js';
const COORDINATOR_AUTHORITY_IMPORT =
  '../../src/core/lib/db/tables/coordinator-authority.js';
const APPLICATION_STATE_STORE_IMPORT =
  '../../src/core/runtime/application-state-store.js';
const APPLICATION_STATE_READINESS_IMPORT =
  '../../src/core/runtime/application-state-readiness.js';
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
const COORDINATOR_AUTHORITY = createCoordinatorAuthorityToken({
  schemaVersion: 1,
  appId: APP_ID,
  coordinatorId: 'durable-host-coordinator',
  authorityId: `wca1_${'A'.repeat(43)}`,
  epoch: 7,
});
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
const APPLICATION_STATE_DB = Object.freeze({ kind: 'application-state-db' });
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
  sessionPath: '/private/tmp/wharfie-durable-host-bridge-sessions',
  readOnly: false,
});
const CONTROL_CONFIGURATION = Object.freeze({
  adapterName: 'lmdb',
  controlPath: CONTROL_CONTEXT.controlPath,
  tableName: CONTROL_CONTEXT.tableName,
  payloadPath: '/private/tmp/wharfie-durable-host-bridge-payloads',
  payloadStoreId: 'durable-host-bridge-payloads',
  sessionPath: CONTROL_CONTEXT.sessionPath,
});
const CAPTURED_CONTROL_CONTEXT = Object.freeze({
  db: CONTROL_CONTEXT.db,
  adapterName: CONTROL_CONTEXT.adapterName,
  controlPath: CONTROL_CONTEXT.controlPath,
  tableName: CONTROL_CONTEXT.tableName,
});
const LOCAL_OWNER = Object.freeze({
  sessionId: 'local-owner-session',
  commandSession: Object.freeze({}),
  ownership: Object.freeze({
    serviceId: 'ledger-service:durable-host-bridge',
    appId: APP_ID,
    scopeId: 'local-scope',
    principalId: 'local-principal',
    sessionId: 'local-owner-session',
    ownerKind: 'manual',
    generation: 1,
  }),
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
const openApplicationStateDB = jest.fn(async () => ({
  db: APPLICATION_STATE_DB,
  context: APPLICATION_STATE_CONFIGURATION,
  close: closeApplicationState,
}));
const assertCoordinatorAuthorityCurrent = jest.fn(
  async (/** @type {Record<string, any>} */ _options) => undefined,
);
const resolveApplicationStateWriteBinding = jest.fn(
  /** @returns {Promise<Readonly<Record<string, any>> | undefined>} */
  async (/** @type {Record<string, any>} */ _options) => undefined,
);
const preflightApplicationStateStoreIdentity = jest.fn(
  async (/** @type {Record<string, any>} */ _options) => undefined,
);
const createBuiltinManagedEffectCatalog = jest.fn(
  async (/** @type {Record<string, any>} */ _options) => ({}),
);
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
const runManualLedgerActivity = jest.fn(
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
);
const resolveExecutionLedgerStoreConfiguration = jest.fn();
const withExecutionLedger = /** @type {any} */ (jest.fn());
const withExecutionLedgerCoordinatorAuthority = jest.fn();
const withLocalLedgerServiceMutationOwnership = jest.fn();
const createLocalOwnerCommandServer = jest.fn();
const createLedgerServiceOwnership = jest.fn();
const createLedgerServiceSessionId = jest.fn();

jest.unstable_mockModule(COORDINATOR_AUTHORITY_IMPORT, () => ({
  ...coordinatorAuthorityModule,
  assertCoordinatorAuthorityCurrent,
}));

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
  openApplicationStateDB,
  resolveApplicationStateStoreConfiguration: () =>
    APPLICATION_STATE_CONFIGURATION,
  validateApplicationStateStoreConfiguration: () =>
    APPLICATION_STATE_CONFIGURATION,
}));

jest.unstable_mockModule(APPLICATION_STATE_READINESS_IMPORT, () => ({
  preflightApplicationStateStoreIdentity,
  resolveApplicationStateWriteBinding,
}));

jest.unstable_mockModule(BUILTIN_EFFECT_CATALOG_IMPORT, () => ({
  createBuiltinManagedEffectCatalog,
  createBuiltinManagedEffectHandler,
}));

jest.unstable_mockModule(MANUAL_LEDGER_RUN_IMPORT, () => ({
  MANUAL_LEDGER_INVOCATION_ID: 'manual',
  createManualLedgerRunId: () => MANUAL_START.runId,
  runManualLedgerActivity,
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
  resolveExecutionLedgerStoreConfiguration,
  withExecutionLedger,
  withExecutionLedgerCoordinatorAuthority,
  withLocalLedgerServiceMutationOwnership,
}));

jest.unstable_mockModule(LOCAL_OWNER_COMMAND_IMPORT, () => ({
  createLocalOwnerCommandServer,
}));

jest.unstable_mockModule(LEDGER_SERVICE_LIFECYCLE_IMPORT, () => ({
  createLedgerServiceOwnership,
  createLedgerServiceSessionId,
}));

jest.unstable_mockModule(EXECUTION_LEDGER_OPERATOR_IMPORT, () => ({
  EXECUTION_LEDGER_CANCEL_OWNER_COMMAND: 'cancel-owner',
}));

beforeEach(() => {
  manualComponentSink.mockClear();
  workflowComponentSink.mockClear();
  closeApplicationState.mockClear();
  openApplicationStateDB.mockClear();
  assertCoordinatorAuthorityCurrent.mockReset();
  assertCoordinatorAuthorityCurrent.mockResolvedValue(undefined);
  resolveApplicationStateWriteBinding.mockReset();
  resolveApplicationStateWriteBinding.mockResolvedValue(undefined);
  preflightApplicationStateStoreIdentity.mockReset();
  preflightApplicationStateStoreIdentity.mockResolvedValue(undefined);
  createBuiltinManagedEffectCatalog.mockClear();
  createBuiltinManagedEffectHandler.mockClear();
  invokeManifestActivityAttemptWithStart.mockClear();
  runManualLedgerActivity.mockClear();
  resolveExecutionLedgerStoreConfiguration.mockClear();
  withExecutionLedger.mockClear();
  withExecutionLedgerCoordinatorAuthority.mockClear();
  withLocalLedgerServiceMutationOwnership.mockClear();
  createLocalOwnerCommandServer.mockClear();
  createLedgerServiceOwnership.mockClear();
  createLedgerServiceSessionId.mockClear();
});

describe('durable host component-frame forwarding', () => {
  it('forwards the manual runner component sink through the durable activity host', async () => {
    const { runDurableManifestActivity } = await import(
      DURABLE_ACTIVITY_HOST_IMPORT
    );

    const getCoordinatorAuthority = jest.fn(() => COORDINATOR_AUTHORITY);
    const getCoordinatorEpoch = jest.fn(() => COORDINATOR_AUTHORITY.epoch);
    await runDurableManifestActivity({
      ledger: /** @type {any} */ ({
        getCoordinatorAuthority,
        getCoordinatorEpoch,
      }),
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
    expect(getCoordinatorAuthority).toHaveBeenCalledTimes(1);
    expect(getCoordinatorEpoch).not.toHaveBeenCalled();
    expect(assertCoordinatorAuthorityCurrent).toHaveBeenCalledWith({
      db: CONTROL_CONTEXT.db,
      tableName: CONTROL_CONTEXT.tableName,
      authority: COORDINATOR_AUTHORITY,
    });
    expect(resolveApplicationStateWriteBinding).toHaveBeenCalledWith({
      appId: APP_ID,
      controlContext: CAPTURED_CONTROL_CONTEXT,
      applicationStateContext: APPLICATION_STATE_CONFIGURATION,
    });
    expect(createBuiltinManagedEffectCatalog).toHaveBeenCalledTimes(1);
    expect(createBuiltinManagedEffectCatalog).toHaveBeenCalledWith({
      db: APPLICATION_STATE_DB,
      appId: APP_ID,
      adapterName: APPLICATION_STATE_CONFIGURATION.adapterName,
      tableName: APPLICATION_STATE_CONFIGURATION.tableName,
      coordinatorAuthority: COORDINATOR_AUTHORITY,
    });
    expect(openApplicationStateDB).toHaveBeenCalledTimes(1);
    expect(closeApplicationState).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: 'missing authority getter', ledger: {} },
    {
      label: 'missing authority token',
      ledger: { getCoordinatorAuthority: () => undefined },
    },
  ])(
    'refuses a $label without inferring authority from an epoch and closes application state',
    async ({ ledger }) => {
      const { runDurableManifestActivity } = await import(
        DURABLE_ACTIVITY_HOST_IMPORT
      );
      const getCoordinatorEpoch = jest.fn(() => COORDINATOR_AUTHORITY.epoch);

      await expect(
        runDurableManifestActivity({
          ledger: /** @type {any} */ ({ ...ledger, getCoordinatorEpoch }),
          controlContext: /** @type {any} */ (CONTROL_CONTEXT),
          applicationStateConfiguration: /** @type {any} */ (
            APPLICATION_STATE_CONFIGURATION
          ),
          execution: /** @type {any} */ (EXECUTION),
          activityName: ACTIVITY_ID,
          idempotencyKey: 'missing-host-authority',
        }),
      ).rejects.toThrow(
        'Writable application-state access requires a coordinator-bound ledger.',
      );

      expect(getCoordinatorEpoch).not.toHaveBeenCalled();
      expect(assertCoordinatorAuthorityCurrent).not.toHaveBeenCalled();
      expect(resolveApplicationStateWriteBinding).toHaveBeenCalledTimes(1);
      expect(createBuiltinManagedEffectCatalog).not.toHaveBeenCalled();
      expect(createBuiltinManagedEffectHandler).not.toHaveBeenCalled();
      expect(invokeManifestActivityAttemptWithStart).not.toHaveBeenCalled();
      expect(openApplicationStateDB).toHaveBeenCalledTimes(1);
      expect(closeApplicationState).toHaveBeenCalledTimes(1);
    },
  );

  it('closes application state when the authority probe rejects before catalog or physical dispatch', async () => {
    const { runDurableManifestActivity } = await import(
      DURABLE_ACTIVITY_HOST_IMPORT
    );
    const stale = new CoordinatorAuthorityStaleError(APP_ID);
    assertCoordinatorAuthorityCurrent.mockRejectedValueOnce(stale);
    const getCoordinatorAuthority = jest.fn(() => COORDINATOR_AUTHORITY);

    await expect(
      runDurableManifestActivity({
        ledger: /** @type {any} */ ({ getCoordinatorAuthority }),
        controlContext: /** @type {any} */ (CONTROL_CONTEXT),
        applicationStateConfiguration: /** @type {any} */ (
          APPLICATION_STATE_CONFIGURATION
        ),
        execution: /** @type {any} */ (EXECUTION),
        activityName: ACTIVITY_ID,
        idempotencyKey: 'stale-host-authority',
      }),
    ).rejects.toBe(stale);

    expect(getCoordinatorAuthority).toHaveBeenCalledTimes(1);
    expect(assertCoordinatorAuthorityCurrent).toHaveBeenCalledWith({
      db: CONTROL_CONTEXT.db,
      tableName: CONTROL_CONTEXT.tableName,
      authority: COORDINATOR_AUTHORITY,
    });
    expect(createBuiltinManagedEffectCatalog).not.toHaveBeenCalled();
    expect(createBuiltinManagedEffectHandler).not.toHaveBeenCalled();
    expect(invokeManifestActivityAttemptWithStart).not.toHaveBeenCalled();
    expect(openApplicationStateDB).toHaveBeenCalledTimes(1);
    expect(closeApplicationState).toHaveBeenCalledTimes(1);
  });

  it('forwards the resident primary-store pin to the writable catalog before dispatch', async () => {
    const { runDurableManifestActivity } = await import(
      DURABLE_ACTIVITY_HOST_IMPORT
    );
    const expectedStoreId = `was_${'A'.repeat(43)}`;
    const destinationAuthorityFloor = Object.freeze({
      record_digest: `waaf1_${'A'.repeat(43)}`,
      epoch: 1,
    });
    resolveApplicationStateWriteBinding.mockResolvedValue(
      Object.freeze({ expectedStoreId, destinationAuthorityFloor }),
    );

    await runDurableManifestActivity({
      ledger: /** @type {any} */ ({
        getCoordinatorAuthority: () => COORDINATOR_AUTHORITY,
      }),
      controlContext: /** @type {any} */ (CONTROL_CONTEXT),
      applicationStateConfiguration: /** @type {any} */ (
        APPLICATION_STATE_CONFIGURATION
      ),
      execution: /** @type {any} */ (EXECUTION),
      activityName: ACTIVITY_ID,
      idempotencyKey: 'pinned-host-store',
    });

    expect(resolveApplicationStateWriteBinding).toHaveBeenCalledWith({
      appId: APP_ID,
      controlContext: CAPTURED_CONTROL_CONTEXT,
      applicationStateContext: APPLICATION_STATE_CONFIGURATION,
    });
    expect(preflightApplicationStateStoreIdentity).toHaveBeenCalledWith({
      configuration: APPLICATION_STATE_CONFIGURATION,
      controlContext: CAPTURED_CONTROL_CONTEXT,
      expectedStoreId,
      appId: APP_ID,
      coordinatorAuthority: COORDINATOR_AUTHORITY,
      destinationAuthorityFloor,
    });
    expect(resolveApplicationStateWriteBinding).toHaveBeenCalledWith({
      appId: APP_ID,
      controlContext: CAPTURED_CONTROL_CONTEXT,
      applicationStateContext: APPLICATION_STATE_CONFIGURATION,
      expectedStoreId,
    });
    expect(createBuiltinManagedEffectCatalog).toHaveBeenCalledWith({
      db: APPLICATION_STATE_DB,
      appId: APP_ID,
      adapterName: APPLICATION_STATE_CONFIGURATION.adapterName,
      tableName: APPLICATION_STATE_CONFIGURATION.tableName,
      coordinatorAuthority: COORDINATOR_AUTHORITY,
      expectedStoreId,
      destinationAuthorityFloor,
    });
    expect(invokeManifestActivityAttemptWithStart).toHaveBeenCalledTimes(1);
    expect(closeApplicationState).toHaveBeenCalledTimes(1);
  });

  it('closes application state without catalog or physical dispatch when the saved binding rejects', async () => {
    const { runDurableManifestActivity } = await import(
      DURABLE_ACTIVITY_HOST_IMPORT
    );
    const conflict = new Error('retained application-state binding conflicts');
    resolveApplicationStateWriteBinding
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(conflict);

    await expect(
      runDurableManifestActivity({
        ledger: /** @type {any} */ ({
          getCoordinatorAuthority: () => COORDINATOR_AUTHORITY,
        }),
        controlContext: /** @type {any} */ (CONTROL_CONTEXT),
        applicationStateConfiguration: /** @type {any} */ (
          APPLICATION_STATE_CONFIGURATION
        ),
        execution: /** @type {any} */ (EXECUTION),
        activityName: ACTIVITY_ID,
        idempotencyKey: 'conflicting-host-store',
      }),
    ).rejects.toBe(conflict);

    expect(assertCoordinatorAuthorityCurrent).toHaveBeenCalledTimes(1);
    expect(resolveApplicationStateWriteBinding).toHaveBeenCalledTimes(2);
    expect(createBuiltinManagedEffectCatalog).not.toHaveBeenCalled();
    expect(createBuiltinManagedEffectHandler).not.toHaveBeenCalled();
    expect(invokeManifestActivityAttemptWithStart).not.toHaveBeenCalled();
    expect(openApplicationStateDB).toHaveBeenCalledTimes(1);
    expect(closeApplicationState).toHaveBeenCalledTimes(1);
  });

  it('refuses a failed known-store preflight before writable open or dispatch', async () => {
    const { runDurableManifestActivity } = await import(
      DURABLE_ACTIVITY_HOST_IMPORT
    );
    const expectedStoreId = `was_${'A'.repeat(43)}`;
    const failure = new Error('saved application-state store is missing');
    resolveApplicationStateWriteBinding.mockResolvedValue(
      Object.freeze({ expectedStoreId }),
    );
    preflightApplicationStateStoreIdentity.mockRejectedValueOnce(failure);

    await expect(
      runDurableManifestActivity({
        ledger: /** @type {any} */ ({
          getCoordinatorAuthority: () => COORDINATOR_AUTHORITY,
        }),
        controlContext: /** @type {any} */ (CONTROL_CONTEXT),
        applicationStateConfiguration: /** @type {any} */ (
          APPLICATION_STATE_CONFIGURATION
        ),
        execution: /** @type {any} */ (EXECUTION),
        activityName: ACTIVITY_ID,
        idempotencyKey: 'failed-preflight-host-store',
      }),
    ).rejects.toBe(failure);

    expect(preflightApplicationStateStoreIdentity).toHaveBeenCalledWith({
      configuration: APPLICATION_STATE_CONFIGURATION,
      controlContext: CAPTURED_CONTROL_CONTEXT,
      expectedStoreId,
    });
    expect(openApplicationStateDB).not.toHaveBeenCalled();
    expect(closeApplicationState).not.toHaveBeenCalled();
    expect(assertCoordinatorAuthorityCurrent).not.toHaveBeenCalled();
    expect(createBuiltinManagedEffectCatalog).not.toHaveBeenCalled();
    expect(invokeManifestActivityAttemptWithStart).not.toHaveBeenCalled();
  });

  it.each(['deleted', 'rolled-back'])(
    'refuses a %s retained ADOPTED barrier during read-only preflight before writable open or dispatch',
    async (state) => {
      const { runDurableManifestActivity } = await import(
        DURABLE_ACTIVITY_HOST_IMPORT
      );
      const expectedStoreId = `was_${'A'.repeat(43)}`;
      const destinationAuthorityFloor = Object.freeze({
        record_digest: `waaf1_${'A'.repeat(43)}`,
        epoch: 1,
      });
      const failure = new Error(`saved application-state barrier is ${state}`);
      resolveApplicationStateWriteBinding.mockResolvedValue(
        Object.freeze({ expectedStoreId, destinationAuthorityFloor }),
      );
      preflightApplicationStateStoreIdentity.mockRejectedValueOnce(failure);

      await expect(
        runDurableManifestActivity({
          ledger: /** @type {any} */ ({
            getCoordinatorAuthority: () => COORDINATOR_AUTHORITY,
          }),
          controlContext: /** @type {any} */ (CONTROL_CONTEXT),
          applicationStateConfiguration: /** @type {any} */ (
            APPLICATION_STATE_CONFIGURATION
          ),
          execution: /** @type {any} */ (EXECUTION),
          activityName: ACTIVITY_ID,
          idempotencyKey: `${state}-barrier-preflight`,
        }),
      ).rejects.toBe(failure);

      expect(preflightApplicationStateStoreIdentity).toHaveBeenCalledWith({
        configuration: APPLICATION_STATE_CONFIGURATION,
        controlContext: CAPTURED_CONTROL_CONTEXT,
        expectedStoreId,
        appId: APP_ID,
        coordinatorAuthority: COORDINATOR_AUTHORITY,
        destinationAuthorityFloor,
      });
      expect(assertCoordinatorAuthorityCurrent).toHaveBeenCalledTimes(1);
      expect(openApplicationStateDB).not.toHaveBeenCalled();
      expect(closeApplicationState).not.toHaveBeenCalled();
      expect(createBuiltinManagedEffectCatalog).not.toHaveBeenCalled();
      expect(invokeManifestActivityAttemptWithStart).not.toHaveBeenCalled();
    },
  );

  it('keeps the captured full token when its caller-owned input changes during the authority probe', async () => {
    const { runDurableManifestActivity } = await import(
      DURABLE_ACTIVITY_HOST_IMPORT
    );
    const mutableToken = { ...COORDINATOR_AUTHORITY };
    const getCoordinatorAuthority = jest.fn(() => mutableToken);
    assertCoordinatorAuthorityCurrent.mockImplementationOnce(async () => {
      mutableToken.coordinatorId = 'caller-mutated-coordinator';
      mutableToken.epoch += 1;
    });

    await runDurableManifestActivity({
      ledger: /** @type {any} */ ({ getCoordinatorAuthority }),
      controlContext: /** @type {any} */ (CONTROL_CONTEXT),
      applicationStateConfiguration: /** @type {any} */ (
        APPLICATION_STATE_CONFIGURATION
      ),
      execution: /** @type {any} */ (EXECUTION),
      activityName: ACTIVITY_ID,
      idempotencyKey: 'captured-host-authority',
    });

    expect(getCoordinatorAuthority).toHaveBeenCalledTimes(1);
    expect(assertCoordinatorAuthorityCurrent).toHaveBeenCalledWith({
      db: CONTROL_CONTEXT.db,
      tableName: CONTROL_CONTEXT.tableName,
      authority: COORDINATOR_AUTHORITY,
    });
    expect(createBuiltinManagedEffectCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ coordinatorAuthority: COORDINATOR_AUTHORITY }),
    );
    expect(invokeManifestActivityAttemptWithStart).toHaveBeenCalledTimes(1);
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

describe('local durable activity host coordinator authority', () => {
  it('uses the local owner session for a bound run and unwinds every scope in order', async () => {
    /** @type {string[]} */
    const order = [];
    const unboundLedger = Object.freeze({ kind: 'unbound-ledger' });
    const boundLedger = Object.freeze({ kind: 'authority-bound-ledger' });
    const outcome = Object.freeze({ status: 'completed' });
    const closeCommandServer = jest.fn(async () => {
      order.push('command-close');
    });

    resolveExecutionLedgerStoreConfiguration.mockReturnValue(
      CONTROL_CONFIGURATION,
    );
    withExecutionLedger.mockImplementation(
      async (
        /** @type {(ledger: any, context: any) => Promise<any>} */ handler,
        /** @type {any} */ options,
      ) => {
        order.push('control-open');
        expect(options).toEqual({ configuration: CONTROL_CONFIGURATION });
        try {
          return await handler(unboundLedger, CONTROL_CONTEXT);
        } finally {
          order.push('control-close');
        }
      },
    );
    withLocalLedgerServiceMutationOwnership.mockImplementation(
      async (/** @type {any} */ options) => {
        order.push('owner-acquire');
        expect(options).toMatchObject({
          appId: APP_ID,
          context: CONTROL_CONTEXT,
        });
        try {
          return await options.handler(LOCAL_OWNER);
        } finally {
          order.push('owner-release');
        }
      },
    );
    withExecutionLedgerCoordinatorAuthority.mockImplementation(
      async (/** @type {any} */ options) => {
        order.push('authority-acquire');
        try {
          return await options.handler(boundLedger, { epoch: 7 });
        } finally {
          order.push('authority-release');
        }
      },
    );
    createLedgerServiceOwnership.mockReturnValue({
      getOwnership: jest.fn(async () => LOCAL_OWNER.ownership),
    });
    createLocalOwnerCommandServer.mockImplementation(async () => {
      order.push('command-open');
      return { close: closeCommandServer };
    });
    runManualLedgerActivity.mockImplementationOnce(
      async (/** @type {any} */ options) => {
        order.push('runner');
        expect(options.ledger).toBe(boundLedger);
        return outcome;
      },
    );

    const { runLocalDurableManifestActivity } = await import(
      DURABLE_ACTIVITY_HOST_IMPORT
    );
    await expect(
      runLocalDurableManifestActivity({
        execution: /** @type {any} */ (EXECUTION),
        activityName: ACTIVITY_ID,
        idempotencyKey: 'local-authority-run',
      }),
    ).resolves.toEqual({
      appId: APP_ID,
      revisionId: REVISION_ID,
      activityName: ACTIVITY_ID,
      idempotencyKey: 'local-authority-run',
      runId: MANUAL_START.runId,
      outcome,
    });

    expect(withExecutionLedgerCoordinatorAuthority).toHaveBeenCalledWith({
      appId: APP_ID,
      coordinatorId: LOCAL_OWNER.sessionId,
      ledger: unboundLedger,
      context: CONTROL_CONTEXT,
      handler: expect.any(Function),
    });
    expect(createLedgerServiceSessionId).not.toHaveBeenCalled();
    expect(order).toEqual([
      'control-open',
      'owner-acquire',
      'authority-acquire',
      'command-open',
      'runner',
      'command-close',
      'authority-release',
      'owner-release',
      'control-close',
    ]);
  });

  it('uses a fresh coordinator identity without opening a command server when no local owner exists', async () => {
    const unboundLedger = Object.freeze({ kind: 'unbound-ledger' });
    const boundLedger = Object.freeze({ kind: 'authority-bound-ledger' });
    const generatedSessionId = 'generated-direct-session';
    const providerContext = Object.freeze({
      ...CONTROL_CONTEXT,
      adapterName: 'dynamodb',
    });
    const providerConfiguration = Object.freeze({
      ...CONTROL_CONFIGURATION,
      adapterName: 'dynamodb',
    });

    resolveExecutionLedgerStoreConfiguration.mockReturnValue(
      providerConfiguration,
    );
    createLedgerServiceSessionId.mockReturnValue(generatedSessionId);
    withExecutionLedger.mockImplementation(
      async (
        /** @type {(ledger: any, context: any) => Promise<any>} */ handler,
      ) => await handler(unboundLedger, providerContext),
    );
    withLocalLedgerServiceMutationOwnership.mockImplementation(
      async (/** @type {any} */ options) => await options.handler(),
    );
    withExecutionLedgerCoordinatorAuthority.mockImplementation(
      async (/** @type {any} */ options) =>
        await options.handler(boundLedger, { epoch: 4 }),
    );
    runManualLedgerActivity.mockImplementationOnce(
      async (/** @type {any} */ options) => {
        expect(options.ledger).toBe(boundLedger);
        return { status: 'completed' };
      },
    );

    const { runLocalDurableManifestActivity } = await import(
      DURABLE_ACTIVITY_HOST_IMPORT
    );
    await expect(
      runLocalDurableManifestActivity({
        execution: /** @type {any} */ (EXECUTION),
        activityName: ACTIVITY_ID,
        idempotencyKey: 'provider-authority-run',
      }),
    ).resolves.toMatchObject({
      appId: APP_ID,
      idempotencyKey: 'provider-authority-run',
      outcome: { status: 'completed' },
    });

    expect(withExecutionLedgerCoordinatorAuthority).toHaveBeenCalledWith({
      appId: APP_ID,
      coordinatorId: generatedSessionId,
      ledger: unboundLedger,
      context: providerContext,
      handler: expect.any(Function),
    });
    expect(createLedgerServiceSessionId).toHaveBeenCalledTimes(1);
    expect(createLocalOwnerCommandServer).not.toHaveBeenCalled();
    expect(createLedgerServiceOwnership).not.toHaveBeenCalled();
  });

  it('fails closed on an active predecessor before opening the command server and still unwinds local ownership', async () => {
    /** @type {string[]} */
    const order = [];
    const unboundLedger = Object.freeze({ kind: 'unbound-ledger' });
    const conflict = new CoordinatorAuthorityConflictError(
      APP_ID,
      'active predecessor retained authority',
    );

    resolveExecutionLedgerStoreConfiguration.mockReturnValue(
      CONTROL_CONFIGURATION,
    );
    withExecutionLedger.mockImplementation(
      async (
        /** @type {(ledger: any, context: any) => Promise<any>} */ handler,
      ) => {
        order.push('control-open');
        try {
          return await handler(unboundLedger, CONTROL_CONTEXT);
        } finally {
          order.push('control-close');
        }
      },
    );
    withLocalLedgerServiceMutationOwnership.mockImplementation(
      async (/** @type {any} */ options) => {
        order.push('owner-acquire');
        try {
          return await options.handler(LOCAL_OWNER);
        } finally {
          order.push('owner-release');
        }
      },
    );
    withExecutionLedgerCoordinatorAuthority.mockImplementation(async () => {
      order.push('authority-conflict');
      throw conflict;
    });

    const { runLocalDurableManifestActivity } = await import(
      DURABLE_ACTIVITY_HOST_IMPORT
    );
    await expect(
      runLocalDurableManifestActivity({
        execution: /** @type {any} */ (EXECUTION),
        activityName: ACTIVITY_ID,
        idempotencyKey: 'blocked-by-predecessor',
      }),
    ).rejects.toBe(conflict);

    expect(createLocalOwnerCommandServer).not.toHaveBeenCalled();
    expect(runManualLedgerActivity).not.toHaveBeenCalled();
    expect(createLedgerServiceSessionId).not.toHaveBeenCalled();
    expect(order).toEqual([
      'control-open',
      'owner-acquire',
      'authority-conflict',
      'owner-release',
      'control-close',
    ]);
  });
});
