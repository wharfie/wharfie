import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const RUNNER_IMPORT =
  '../../src/core/runtime/deployment-aws-operation-runner.js';
const REVISION_IMPORT = '../../src/core/runtime/deployment-revision.js';
const PROFILE_IMPORT = '../../src/core/runtime/deployment-profile.js';
const PLAN_IMPORT = '../../src/core/runtime/deployment-plan.js';
const HEAD_IMPORT = '../../src/core/runtime/deployment-head.js';
const INSPECTION_IMPORT = '../../src/core/runtime/deployment-inspection.js';
const ARTIFACT_STAGE_IMPORT =
  '../../src/core/runtime/deployment-artifact-stage.js';
const PROVIDER_SCOPE_IMPORT =
  '../../src/core/runtime/deployment-provider-scope.js';
const LOGICAL_ID_IMPORT = '../../src/core/runtime/logical-id.js';
const LIFECYCLE_IMPORT = '../../src/core/runtime/deployment-aws-lifecycle.js';

/** @type {jest.Mock<(request: any) => Promise<any>>} */
const runOperation = jest.fn();
/** @type {jest.Mock<(request: any) => Promise<any>>} */
const createRunningDeploymentRevision = jest.fn();
/** @type {jest.Mock<(value: any) => any>} */
const validateDeploymentRevision = jest.fn();
/** @type {jest.Mock<(value: any) => any>} */
const validateDeploymentProfile = jest.fn();
/** @type {jest.Mock<(value: any) => any>} */
const validateDeploymentPlanContext = jest.fn();
/** @type {jest.Mock<(value: any) => any>} */
const validateDeploymentHead = jest.fn();
/** @type {jest.Mock<(value: any) => any>} */
const validateDeploymentInspection = jest.fn();
/** @type {jest.Mock<(value: any) => any>} */
const validateStageIntent = jest.fn();
/** @type {jest.Mock<(value: any) => any>} */
const validateStageReceipt = jest.fn();
/** @type {jest.Mock<(value: any) => void>} */
const assertDeploymentInstanceId = jest.fn();
/** @type {jest.Mock<(value: any) => void>} */
const assertLogicalId = jest.fn();

jest.unstable_mockModule(RUNNER_IMPORT, () => ({
  runAwsSingleNodeDeploymentOperation: runOperation,
}));
jest.unstable_mockModule(REVISION_IMPORT, () => ({
  createRunningDeploymentRevision,
  validateDeploymentRevision,
}));
jest.unstable_mockModule(PROFILE_IMPORT, () => ({
  validateDeploymentProfile,
}));
jest.unstable_mockModule(PLAN_IMPORT, () => ({
  validateDeploymentPlanContext,
}));
jest.unstable_mockModule(HEAD_IMPORT, () => ({
  validateDeploymentHead,
}));
jest.unstable_mockModule(INSPECTION_IMPORT, () => ({
  validateDeploymentInspection,
}));
jest.unstable_mockModule(ARTIFACT_STAGE_IMPORT, () => ({
  validateDeploymentArtifactStageIntentContext: validateStageIntent,
  validateDeploymentArtifactStageReceiptContext: validateStageReceipt,
}));
jest.unstable_mockModule(PROVIDER_SCOPE_IMPORT, () => ({
  assertDeploymentInstanceId,
}));
jest.unstable_mockModule(LOGICAL_ID_IMPORT, () => ({
  assertLogicalId,
}));

const {
  AwsDeploymentOperationIncompleteError,
  applyAwsPreparedRunningSeaPlan,
  applyAwsPreparedStagedPlan,
  applyAwsRunningSea,
  destroyAwsDeployment,
  inspectAwsDeployment,
  prepareAwsRunningSeaPlan,
  reconcileAwsRunningSeaDeployment,
  reconcileAwsStagedDeployment,
} = await import(LIFECYCLE_IMPORT);

const region = 'us-east-1';
const controlPolicy = 'require-active';
const deploymentInstanceId = 'deployment-instance';
const deployment = { id: 'production' };
const providerScope = {
  schemaVersion: 1,
  kind: 'providerScope',
  providerScopeId: 'provider-scope',
  provider: 'aws',
  partition: 'aws',
  accountId: '123456789012',
  region,
};
const profile = {
  schemaVersion: 2,
  kind: 'deploymentProfile',
  profileRevisionId: 'profile-revision',
  profile: { id: 'production' },
  appId: 'demo',
  target: {
    nodeVersion: '24.13.1',
    platform: 'linux',
    architecture: 'x64',
    libc: 'glibc',
  },
  mode: { kind: 'single-node-systemd-user', version: 1 },
  provider: {
    kind: 'aws',
    contractVersion: 3,
    scope: { region },
    configuration: {},
  },
};
const deploymentRevision = {
  schemaVersion: 1,
  kind: 'deploymentRevision',
  deploymentRevisionId: 'deployment-revision',
  deployment,
  appId: 'demo',
  revisionId: 'application-revision',
  artifactId: 'artifact',
  profileRevisionId: 'profile-revision',
};
const providerSpec = {
  schemaVersion: 3,
  kind: 'awsSingleNodeProviderSpec',
  providerSpecId: 'provider-spec',
};
const stage = {
  intent: {
    schemaVersion: 1,
    kind: 'deploymentArtifactStageIntent',
    stageIntentId: 'stage-intent',
  },
  receipt: {
    schemaVersion: 1,
    kind: 'deploymentArtifactStageReceipt',
    stageReceiptId: 'stage-receipt',
  },
};

/** @param {any} value @returns {any} */
function cloneFrozen(value) {
  if (value === null || typeof value !== 'object') return value;
  const clone = Array.isArray(value)
    ? value.map((child) => cloneFrozen(child))
    : Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, cloneFrozen(child)]),
      );
  return Object.freeze(clone);
}

/** @param {'apply'|'reconcile'|'destroy'} operation @param {string} [planId] */
function makePlan(operation, planId = `${operation}-plan`) {
  return {
    schemaVersion: 3,
    kind: 'deploymentPlan',
    planId,
    operation,
    deploymentRevision,
    providerScope,
    providerSpec,
    deploymentInstanceId,
    incarnationId: 'incarnation',
    basis: {
      headGeneration: operation === 'apply' ? 0 : 2,
      settledDeploymentRevisionId:
        operation === 'apply' ? null : deploymentRevision.deploymentRevisionId,
      inspectionId: `${operation}-inspection`,
    },
    actions: [],
    summary: {
      create: 0,
      update: 0,
      delete: 0,
      verify: 0,
      noop: 0,
      destructive: 0,
    },
  };
}

/** @param {Record<string, any>} plan @param {'CONVERGING'|'READY'|'DESTROYING'|'DESTROYED'} phase */
function makeHead(plan, phase) {
  const active = phase === 'CONVERGING' || phase === 'DESTROYING';
  const operationKind =
    plan.operation === 'destroy'
      ? 'destroy'
      : plan.basis.settledDeploymentRevisionId === null
        ? 'create'
        : plan.basis.settledDeploymentRevisionId ===
            plan.deploymentRevision.deploymentRevisionId
          ? 'reconcile'
          : 'update';
  return {
    schemaVersion: 2,
    kind: 'deploymentHead',
    headId: `${phase.toLowerCase()}-head`,
    deploymentInstanceId,
    providerScope,
    incarnationId: plan.incarnationId,
    generation: 3,
    phase,
    settledDeploymentRevisionId:
      phase === 'DESTROYED'
        ? null
        : active
          ? plan.basis.settledDeploymentRevisionId
          : deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId:
      phase === 'DESTROYING' || phase === 'DESTROYED'
        ? null
        : deploymentRevision.deploymentRevisionId,
    resourceBindings: [],
    activeOperation: active
      ? {
          operationId: `${plan.planId}-operation`,
          kind: operationKind,
          planId: plan.planId,
          status: 'blocked',
          nextActionIndex: 0,
          intents: [],
        }
      : null,
    lastOperation: active
      ? null
      : {
          operationId: `${plan.planId}-operation`,
          kind: operationKind,
          planId: plan.planId,
          intents: [],
        },
  };
}

/**
 * @param {Record<string, any>} plan
 * @param {Record<string, any>} head
 * @param {string} status
 */
function makeInspection(plan, head, status) {
  return {
    schemaVersion: 6,
    kind: 'deploymentInspection',
    inspectionId: `${status}-inspection`,
    deploymentRevision: plan.deploymentRevision,
    providerScope: plan.providerScope,
    providerSpecId: plan.providerSpec.providerSpecId,
    deploymentInstanceId,
    controlState: { status: 'present', evidence: 'provider-head-read' },
    incarnationId: head.incarnationId,
    headGeneration: head.generation,
    status,
    resources: [],
  };
}

/**
 * @param {Record<string, any>} plan
 * @param {'CONVERGING'|'READY'|'DESTROYING'|'DESTROYED'} phase
 * @param {string} status
 */
function makeInspectionEnvelope(plan, phase, status) {
  const head = makeHead(plan, phase);
  const active = phase === 'CONVERGING' || phase === 'DESTROYING';
  return {
    schemaVersion: 1,
    kind: 'deploymentControllerInspection',
    deploymentInstanceId,
    status,
    head,
    activePlan: active ? plan : null,
    lastOperationPlan: active ? null : plan,
    profile,
    providerSpec,
    inspection: makeInspection(plan, head, status),
  };
}

function makeAbsentInspection() {
  return {
    schemaVersion: 1,
    kind: 'deploymentControllerInspection',
    deploymentInstanceId,
    status: 'absent',
    head: null,
    activePlan: null,
    lastOperationPlan: null,
    profile: null,
    providerSpec: null,
    inspection: null,
  };
}

function runningRequest() {
  return {
    deployment: { ...deployment },
    profile: JSON.parse(JSON.stringify(profile)),
    controlPolicy,
  };
}

function locatedRequest() {
  return { deploymentInstanceId, region, controlPolicy };
}

function reconcileRequest(confirmCoordinatorStopped = false) {
  return {
    ...locatedRequest(),
    confirmCoordinatorStopped,
  };
}

/** @param {unknown} value */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

beforeEach(() => {
  jest.resetAllMocks();
  validateDeploymentRevision.mockImplementation((value) => cloneFrozen(value));
  validateDeploymentProfile.mockImplementation((value) => cloneFrozen(value));
  validateDeploymentPlanContext.mockImplementation((value) =>
    cloneFrozen(value),
  );
  validateDeploymentHead.mockImplementation((value) => cloneFrozen(value));
  validateDeploymentInspection.mockImplementation((value) =>
    cloneFrozen(value),
  );
  validateStageIntent.mockImplementation((value) => cloneFrozen(value));
  validateStageReceipt.mockImplementation((value) => cloneFrozen(value));
  assertDeploymentInstanceId.mockImplementation(() => undefined);
  assertLogicalId.mockImplementation(() => undefined);
  createRunningDeploymentRevision.mockResolvedValue(
    cloneFrozen(deploymentRevision),
  );
});

describe('AWS deployment lifecycle orchestration', () => {
  it('prepares a running-SEA apply plan without staging', async () => {
    const plan = makePlan('apply');
    runOperation.mockResolvedValueOnce(plan);

    const result = await prepareAwsRunningSeaPlan(runningRequest());

    expect(result).toEqual({ plan, profile });
    expectDeepFrozen(result);
    expect(createRunningDeploymentRevision).toHaveBeenCalledWith({
      deployment,
      profile,
    });
    expect(runOperation).toHaveBeenCalledWith({
      region,
      controlPolicy,
      operation: 'plan',
      input: {
        operation: 'apply',
        deploymentRevision,
        profile,
      },
    });
  });

  it('plans then ordinarily converges a running SEA', async () => {
    const plan = makePlan('apply');
    const head = makeHead(plan, 'READY');
    runOperation.mockResolvedValueOnce(plan).mockResolvedValueOnce(head);

    await expect(applyAwsRunningSea(runningRequest())).resolves.toEqual(head);

    expect(
      runOperation.mock.calls.map(([request]) => request.operation),
    ).toEqual(['plan', 'converge']);
    expect(runOperation.mock.calls[1][0].input).toEqual({ plan, profile });
  });

  it('ordinarily converges an exact prepared running plan without replanning', async () => {
    const plan = makePlan('apply');
    const head = makeHead(plan, 'READY');
    runOperation.mockResolvedValueOnce(head);

    await expect(
      applyAwsPreparedRunningSeaPlan({
        prepared: { plan, profile },
        controlPolicy,
      }),
    ).resolves.toEqual(head);

    expect(createRunningDeploymentRevision).not.toHaveBeenCalled();
    expect(runOperation).toHaveBeenCalledWith({
      region,
      controlPolicy,
      operation: 'converge',
      input: { plan, profile },
    });
  });

  it('uses only explicit pre-staged convergence for a selected-SEA plan', async () => {
    const plan = makePlan('apply');
    const head = makeHead(plan, 'READY');
    runOperation.mockResolvedValueOnce(head);

    await expect(
      applyAwsPreparedStagedPlan({
        prepared: { plan, profile, artifactStage: stage },
        controlPolicy,
      }),
    ).resolves.toEqual(head);

    expect(runOperation).toHaveBeenCalledWith({
      region,
      controlPolicy,
      operation: 'converge-pre-staged',
      input: { plan, profile, artifactStage: stage },
    });
    expect(validateStageIntent).toHaveBeenCalledTimes(1);
    expect(validateStageReceipt).toHaveBeenCalledTimes(1);
  });

  it('rejects prepared plan envelopes from the other artifact-authority surface before I/O', async () => {
    const plan = makePlan('apply');

    await expect(
      applyAwsPreparedRunningSeaPlan({
        prepared: { plan, profile, artifactStage: stage },
        controlPolicy,
      }),
    ).rejects.toThrow(/prepared plan is invalid/i);
    await expect(
      applyAwsPreparedStagedPlan({
        prepared: { plan, profile },
        controlPolicy,
      }),
    ).rejects.toThrow(/prepared plan is invalid/i);

    expect(createRunningDeploymentRevision).not.toHaveBeenCalled();
    expect(runOperation).not.toHaveBeenCalled();
  });

  it('reports a blocked apply head as an incomplete operation, not success', async () => {
    const plan = makePlan('apply');
    runOperation.mockResolvedValueOnce(makeHead(plan, 'CONVERGING'));

    const operation = applyAwsPreparedRunningSeaPlan({
      prepared: { plan, profile },
      controlPolicy,
    });

    await expect(operation).rejects.toBeInstanceOf(
      AwsDeploymentOperationIncompleteError,
    );
    await expect(operation).rejects.toMatchObject({
      code: 'AWS_DEPLOYMENT_OPERATION_INCOMPLETE',
    });
  });

  it('rejects a runner plan for another lifecycle operation', async () => {
    runOperation.mockResolvedValueOnce(makePlan('reconcile'));

    await expect(prepareAwsRunningSeaPlan(runningRequest())).rejects.toThrow(
      /operation result is invalid/i,
    );

    expect(runOperation).toHaveBeenCalledTimes(1);
  });

  it('performs a source-independent read-only deployment inspection', async () => {
    const plan = makePlan('apply');
    const envelope = makeInspectionEnvelope(plan, 'READY', 'converged');
    runOperation.mockResolvedValueOnce(envelope);

    const result = await inspectAwsDeployment(locatedRequest());

    expect(result).toEqual(envelope);
    expectDeepFrozen(result);
    expect(createRunningDeploymentRevision).not.toHaveBeenCalled();
    expect(runOperation).toHaveBeenCalledWith({
      region,
      controlPolicy,
      operation: 'inspect',
      input: { deploymentInstanceId },
    });
  });

  it('rejects an inspection envelope for another deployment instance', async () => {
    const plan = makePlan('apply');
    runOperation.mockResolvedValueOnce({
      ...makeInspectionEnvelope(plan, 'READY', 'converged'),
      deploymentInstanceId: 'foreign-instance',
    });

    await expect(inspectAwsDeployment(locatedRequest())).rejects.toThrow(
      /operation result is invalid/i,
    );
  });

  it('rejects inspection plans that do not fully correlate to the durable head', async () => {
    const activePlan = makePlan('apply', 'active-plan');
    const activeEnvelope = makeInspectionEnvelope(
      activePlan,
      'CONVERGING',
      'in-flight',
    );
    const settledPlan = makePlan('apply', 'settled-plan');
    const settledEnvelope = makeInspectionEnvelope(
      settledPlan,
      'READY',
      'converged',
    );
    const destroyPlan = makePlan('destroy', 'destroy-plan');
    const destroyedEnvelope = makeInspectionEnvelope(
      destroyPlan,
      'DESTROYED',
      'destroyed',
    );
    const cases = [
      {
        ...activeEnvelope,
        activePlan: { ...activePlan, incarnationId: 'other-incarnation' },
      },
      {
        ...activeEnvelope,
        head: {
          ...activeEnvelope.head,
          activeOperation: {
            ...activeEnvelope.head.activeOperation,
            kind: 'update',
          },
        },
      },
      {
        ...activeEnvelope,
        activePlan: {
          ...activePlan,
          actions: [{ actionId: 'unmatched-action' }],
        },
      },
      {
        ...settledEnvelope,
        lastOperationPlan: {
          ...settledPlan,
          basis: {
            ...settledPlan.basis,
            headGeneration: settledEnvelope.head.generation,
          },
        },
      },
      {
        ...destroyedEnvelope,
        lastOperationPlan: {
          ...destroyPlan,
          basis: {
            ...destroyPlan.basis,
            settledDeploymentRevisionId: null,
          },
        },
      },
    ];

    for (const envelope of cases) {
      runOperation.mockResolvedValueOnce(envelope);
      await expect(inspectAwsDeployment(locatedRequest())).rejects.toThrow(
        /operation result is invalid/i,
      );
    }
  });

  it('re-observes the running SEA before a fresh reconcile', async () => {
    const settledPlan = makePlan('apply', 'settled-plan');
    const reconcilePlan = makePlan('reconcile');
    const envelope = makeInspectionEnvelope(settledPlan, 'READY', 'converged');
    const head = makeHead(reconcilePlan, 'READY');
    runOperation
      .mockResolvedValueOnce(envelope)
      .mockResolvedValueOnce(reconcilePlan)
      .mockResolvedValueOnce(head);

    await expect(
      reconcileAwsRunningSeaDeployment(reconcileRequest()),
    ).resolves.toEqual(head);

    expect(createRunningDeploymentRevision).toHaveBeenCalledWith({
      deployment,
      profile,
    });
    expect(
      runOperation.mock.calls.map(([request]) => request.operation),
    ).toEqual(['inspect', 'plan', 'converge']);
    expect(runOperation.mock.calls[1][0].input).toEqual({
      operation: 'reconcile',
      deploymentRevision,
      profile,
    });
  });

  it('refuses running reconcile when this SEA is not the settled revision', async () => {
    const settledPlan = makePlan('apply', 'settled-plan');
    runOperation.mockResolvedValueOnce(
      makeInspectionEnvelope(settledPlan, 'READY', 'converged'),
    );
    createRunningDeploymentRevision.mockResolvedValueOnce({
      ...deploymentRevision,
      deploymentRevisionId: 'different-revision',
    });

    await expect(
      reconcileAwsRunningSeaDeployment(reconcileRequest()),
    ).rejects.toThrow(/does not match the exact settled/i);

    expect(runOperation).toHaveBeenCalledTimes(1);
  });

  it('validates durable stage evidence before pre-staged reconcile', async () => {
    const settledPlan = makePlan('apply', 'settled-plan');
    const reconcilePlan = makePlan('reconcile');
    const envelope = makeInspectionEnvelope(settledPlan, 'READY', 'converged');
    const head = makeHead(reconcilePlan, 'READY');
    runOperation
      .mockResolvedValueOnce(envelope)
      .mockResolvedValueOnce(reconcilePlan)
      .mockResolvedValueOnce(stage)
      .mockResolvedValueOnce(head);

    await expect(
      reconcileAwsStagedDeployment(reconcileRequest()),
    ).resolves.toEqual(head);

    expect(createRunningDeploymentRevision).not.toHaveBeenCalled();
    expect(
      runOperation.mock.calls.map(([request]) => request.operation),
    ).toEqual([
      'inspect',
      'plan',
      'validate-staged-artifact',
      'converge-pre-staged',
    ]);
    expect(runOperation.mock.calls[2][0].input).toEqual({
      deploymentRevision,
      profile,
      providerScope,
    });
    expect(runOperation.mock.calls[3][0].input).toEqual({
      plan: reconcilePlan,
      profile,
      artifactStage: stage,
    });
  });

  it('reports a blocked reconcile head as an incomplete operation, not success', async () => {
    const settledPlan = makePlan('apply', 'settled-plan');
    const reconcilePlan = makePlan('reconcile');
    runOperation
      .mockResolvedValueOnce(
        makeInspectionEnvelope(settledPlan, 'READY', 'converged'),
      )
      .mockResolvedValueOnce(reconcilePlan)
      .mockResolvedValueOnce(makeHead(reconcilePlan, 'CONVERGING'));

    await expect(
      reconcileAwsRunningSeaDeployment(reconcileRequest()),
    ).rejects.toBeInstanceOf(AwsDeploymentOperationIncompleteError);
  });

  it('requires explicit stopped-coordinator confirmation before recovery', async () => {
    const activePlan = makePlan('apply', 'active-plan');
    runOperation.mockResolvedValueOnce(
      makeInspectionEnvelope(activePlan, 'CONVERGING', 'in-flight'),
    );

    await expect(
      reconcileAwsRunningSeaDeployment(reconcileRequest(false)),
    ).rejects.toThrow(/confirm the former coordinator is stopped/i);

    expect(runOperation).toHaveBeenCalledTimes(1);
    expect(createRunningDeploymentRevision).not.toHaveBeenCalled();
  });

  it('re-proves the running SEA before resuming the exact active plan', async () => {
    const activePlan = makePlan('apply', 'active-plan');
    const resumed = makeHead(activePlan, 'READY');
    runOperation
      .mockResolvedValueOnce(
        makeInspectionEnvelope(activePlan, 'CONVERGING', 'in-flight'),
      )
      .mockResolvedValueOnce(resumed);

    await expect(
      reconcileAwsRunningSeaDeployment(reconcileRequest(true)),
    ).resolves.toEqual(resumed);

    expect(createRunningDeploymentRevision).toHaveBeenCalledWith({
      deployment,
      profile,
    });
    expect(
      runOperation.mock.calls.map(([request]) => request.operation),
    ).toEqual(['inspect', 'resume']);
    expect(runOperation.mock.calls[1][0].input).toEqual({
      deploymentInstanceId,
      expectedPlanId: activePlan.planId,
    });
  });

  it('uses only durable authority when resuming a staged active plan', async () => {
    const activePlan = makePlan('apply', 'active-plan');
    const resumed = makeHead(activePlan, 'READY');
    runOperation
      .mockResolvedValueOnce(
        makeInspectionEnvelope(activePlan, 'CONVERGING', 'in-flight'),
      )
      .mockResolvedValueOnce(resumed);

    await expect(
      reconcileAwsStagedDeployment(reconcileRequest(true)),
    ).resolves.toEqual(resumed);

    expect(createRunningDeploymentRevision).not.toHaveBeenCalled();
    expect(
      runOperation.mock.calls.map(([request]) => request.operation),
    ).toEqual(['inspect', 'resume']);
    expect(runOperation.mock.calls[1][0].input).toEqual({
      deploymentInstanceId,
      expectedPlanId: activePlan.planId,
    });
  });

  it('recovers an active destroy without requiring running-SEA authority', async () => {
    const activePlan = makePlan('destroy', 'active-destroy-plan');
    const resumed = makeHead(activePlan, 'DESTROYED');
    runOperation
      .mockResolvedValueOnce(
        makeInspectionEnvelope(activePlan, 'DESTROYING', 'in-flight'),
      )
      .mockResolvedValueOnce(resumed);

    await expect(
      reconcileAwsRunningSeaDeployment(reconcileRequest(true)),
    ).resolves.toEqual(resumed);

    expect(createRunningDeploymentRevision).not.toHaveBeenCalled();
    expect(
      runOperation.mock.calls.map(([request]) => request.operation),
    ).toEqual(['inspect', 'resume']);
    expect(runOperation.mock.calls[1][0].input).toEqual({
      deploymentInstanceId,
      expectedPlanId: activePlan.planId,
    });
  });

  it('does not resume when the running SEA differs from the active revision', async () => {
    const activePlan = makePlan('apply', 'active-plan');
    runOperation.mockResolvedValueOnce(
      makeInspectionEnvelope(activePlan, 'CONVERGING', 'in-flight'),
    );
    createRunningDeploymentRevision.mockResolvedValueOnce({
      ...deploymentRevision,
      deploymentRevisionId: 'different-active-revision',
    });

    await expect(
      reconcileAwsRunningSeaDeployment(reconcileRequest(true)),
    ).rejects.toThrow(/does not match the exact active/i);

    expect(createRunningDeploymentRevision).toHaveBeenCalledWith({
      deployment,
      profile,
    });
    expect(runOperation).toHaveBeenCalledTimes(1);
  });

  it('returns an absent inspection without planning or staging destroy', async () => {
    const absent = makeAbsentInspection();
    runOperation.mockResolvedValueOnce(absent);

    await expect(destroyAwsDeployment(locatedRequest())).resolves.toEqual(
      absent,
    );

    expect(runOperation).toHaveBeenCalledTimes(1);
    expect(createRunningDeploymentRevision).not.toHaveBeenCalled();
  });

  it('returns an existing DESTROYED head without another operation', async () => {
    const destroyPlan = makePlan('destroy');
    const envelope = makeInspectionEnvelope(
      destroyPlan,
      'DESTROYED',
      'destroyed',
    );
    runOperation.mockResolvedValueOnce(envelope);

    await expect(destroyAwsDeployment(locatedRequest())).resolves.toEqual(
      envelope.head,
    );

    expect(runOperation).toHaveBeenCalledTimes(1);
  });

  it.each(['drifted', 'conflict', 'unknown'])(
    'does not report an existing DESTROYED head as success when provider proof is %s',
    async (status) => {
      const destroyPlan = makePlan('destroy');
      const envelope = makeInspectionEnvelope(destroyPlan, 'DESTROYED', status);
      runOperation.mockResolvedValueOnce(envelope);

      await expect(destroyAwsDeployment(locatedRequest())).rejects.toThrow(
        /destruction is not proven/i,
      );

      expect(runOperation).toHaveBeenCalledTimes(1);
    },
  );

  it('destroys READY state through null pre-staged authority', async () => {
    const settledPlan = makePlan('apply', 'settled-plan');
    const destroyPlan = makePlan('destroy');
    const destroyed = makeHead(destroyPlan, 'DESTROYED');
    runOperation
      .mockResolvedValueOnce(
        makeInspectionEnvelope(settledPlan, 'READY', 'converged'),
      )
      .mockResolvedValueOnce(destroyPlan)
      .mockResolvedValueOnce(destroyed);

    await expect(destroyAwsDeployment(locatedRequest())).resolves.toEqual(
      destroyed,
    );

    expect(
      runOperation.mock.calls.map(([request]) => request.operation),
    ).toEqual(['inspect', 'plan', 'converge-pre-staged']);
    expect(runOperation.mock.calls[2][0].input).toEqual({
      plan: destroyPlan,
      profile,
      artifactStage: null,
    });
    expect(createRunningDeploymentRevision).not.toHaveBeenCalled();
    expect(validateStageIntent).not.toHaveBeenCalled();
  });

  it('reports a blocked destroy head as an incomplete operation, not success', async () => {
    const settledPlan = makePlan('apply', 'settled-plan');
    const destroyPlan = makePlan('destroy');
    runOperation
      .mockResolvedValueOnce(
        makeInspectionEnvelope(settledPlan, 'READY', 'converged'),
      )
      .mockResolvedValueOnce(destroyPlan)
      .mockResolvedValueOnce(makeHead(destroyPlan, 'DESTROYING'));

    await expect(destroyAwsDeployment(locatedRequest())).rejects.toBeInstanceOf(
      AwsDeploymentOperationIncompleteError,
    );
  });

  it('rejects a destroy result whose plan does not target its settled basis', async () => {
    const settledPlan = makePlan('apply', 'settled-plan');
    const destroyPlan = makePlan('destroy');
    const invalidPlan = {
      ...destroyPlan,
      basis: {
        ...destroyPlan.basis,
        settledDeploymentRevisionId: 'different-revision',
      },
    };
    runOperation
      .mockResolvedValueOnce(
        makeInspectionEnvelope(settledPlan, 'READY', 'converged'),
      )
      .mockResolvedValueOnce(invalidPlan)
      .mockResolvedValueOnce(makeHead(invalidPlan, 'DESTROYED'));

    await expect(destroyAwsDeployment(locatedRequest())).rejects.toThrow(
      /operation result is invalid/i,
    );
  });

  it('rejects under-correlated terminal controller heads', async () => {
    const basePlan = makePlan('apply');
    const withAction = {
      ...basePlan,
      actions: [{ actionId: 'expected-action' }],
    };
    const cases = [
      {
        plan: basePlan,
        head: {
          ...makeHead(basePlan, 'READY'),
          lastOperation: {
            ...makeHead(basePlan, 'READY').lastOperation,
            kind: 'update',
          },
        },
      },
      {
        plan: withAction,
        head: {
          ...makeHead(withAction, 'READY'),
          lastOperation: {
            ...makeHead(withAction, 'READY').lastOperation,
            intents: [{ actionId: 'wrong-action' }],
          },
        },
      },
      {
        plan: basePlan,
        head: {
          ...makeHead(basePlan, 'READY'),
          settledDeploymentRevisionId: 'different-revision',
        },
      },
    ];

    for (const { plan, head } of cases) {
      runOperation.mockResolvedValueOnce(head);
      await expect(
        applyAwsPreparedRunningSeaPlan({
          prepared: { plan, profile },
          controlPolicy,
        }),
      ).rejects.toThrow(/operation result is invalid/i);
    }
  });

  it('refuses destroy while any deployment operation is active', async () => {
    const activePlan = makePlan('apply', 'active-plan');
    runOperation.mockResolvedValueOnce(
      makeInspectionEnvelope(activePlan, 'CONVERGING', 'in-flight'),
    );

    await expect(destroyAwsDeployment(locatedRequest())).rejects.toThrow(
      /READY and inactive/i,
    );

    expect(runOperation).toHaveBeenCalledTimes(1);
  });

  it('rejects non-exact requests before observing runtime or credentials', async () => {
    const accessor = {
      deployment: { ...deployment },
      profile,
    };
    Object.defineProperty(accessor, 'controlPolicy', {
      enumerable: true,
      get() {
        throw new Error('must not run');
      },
    });

    await expect(prepareAwsRunningSeaPlan(accessor)).rejects.toThrow(
      /request is invalid/i,
    );
    await expect(
      inspectAwsDeployment({ ...locatedRequest(), extra: true }),
    ).rejects.toThrow(/request is invalid/i);
    await expect(
      reconcileAwsStagedDeployment({
        ...locatedRequest(),
        confirmCoordinatorStopped: 'yes',
      }),
    ).rejects.toThrow(/request is invalid/i);
    await expect(
      applyAwsPreparedRunningSeaPlan({
        prepared: {
          plan: makePlan('apply'),
          profile,
          unsupported: true,
        },
        controlPolicy,
      }),
    ).rejects.toThrow(/prepared plan is invalid/i);

    expect(createRunningDeploymentRevision).not.toHaveBeenCalled();
    expect(runOperation).not.toHaveBeenCalled();
  });
});
