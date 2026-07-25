/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc, no-throw-literal, prefer-promise-reject-errors -- Non-Error throws are intentional cleanup-contract fixtures. */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const SELECTED_SEA_IMPORT = '../../../src/cli/app/selected-sea-artifact.js';
const AWS_INVOCATION_IMPORT =
  '../../../src/core/runtime/deployment-aws-invocation.js';
const DEPLOYMENT_PROFILE_IMPORT =
  '../../../src/core/runtime/deployment-profile.js';
const PROVIDER_SCOPE_IMPORT =
  '../../../src/core/runtime/deployment-provider-scope.js';
const DEPLOYMENT_PLAN_IMPORT = '../../../src/core/runtime/deployment-plan.js';
const ARTIFACT_STAGE_IMPORT =
  '../../../src/core/runtime/deployment-artifact-stage.js';
const SOURCE_DEPLOYMENT_IMPORT =
  '../../../src/cli/app/aws-source-deployment.js';

/** @type {string[]} */
const order = [];
const packageSelectedSeaArtifact = jest.fn();
const createSelectedSeaDeploymentRevision = jest.fn();
const claimSelectedSeaArtifactSource = jest.fn();
const discardSelectedSeaArtifact = jest.fn();
const openAwsSingleNodeDeploymentInvocation = jest.fn();
const validateDeploymentProfile = jest.fn();
const validateProviderScope = jest.fn();
const validateDeploymentPlanContext = jest.fn();
const validateDeploymentArtifactStageIntentContext = jest.fn();
const validateDeploymentArtifactStageReceiptContext = jest.fn();
const requireControl = jest.fn();
const reconcileControl = jest.fn();
const bootstrapControl = jest.fn();
const planOperation = jest.fn();
const stageClaimedArtifact = jest.fn();
const convergePreStaged = jest.fn();
const closeInvocation = jest.fn();
const closeClaimedSource = jest.fn();

jest.unstable_mockModule(SELECTED_SEA_IMPORT, () => ({
  packageSelectedSeaArtifact,
  createSelectedSeaDeploymentRevision,
  claimSelectedSeaArtifactSource,
  discardSelectedSeaArtifact,
}));
jest.unstable_mockModule(AWS_INVOCATION_IMPORT, () => ({
  openAwsSingleNodeDeploymentInvocation,
}));
jest.unstable_mockModule(DEPLOYMENT_PROFILE_IMPORT, () => ({
  validateDeploymentProfile,
}));
jest.unstable_mockModule(PROVIDER_SCOPE_IMPORT, () => ({
  validateProviderScope,
}));
jest.unstable_mockModule(DEPLOYMENT_PLAN_IMPORT, () => ({
  validateDeploymentPlanContext,
}));
jest.unstable_mockModule(ARTIFACT_STAGE_IMPORT, () => ({
  validateDeploymentArtifactStageIntentContext,
  validateDeploymentArtifactStageReceiptContext,
}));

const { applyAwsSelectedSea, prepareAwsSelectedSeaPlan } = await import(
  SOURCE_DEPLOYMENT_IMPORT
);

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {any} value @returns {any} */
function cloneFrozen(value) {
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function deferred() {
  /** @type {(value?: any) => void} */
  let settleResolve = () => {
    throw new Error('Deferred promise was not initialized.');
  };
  /** @type {(error?: any) => void} */
  let settleReject = () => {
    throw new Error('Deferred promise was not initialized.');
  };
  const promise = new Promise((resolve, reject) => {
    settleResolve = resolve;
    settleReject = reject;
  });
  return { promise, resolve: settleResolve, reject: settleReject };
}

/** @param {any} value @returns {void} */
function assertDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

const authority = Object.freeze(Object.create(null));
const packageRequest = {
  dir: '/workspace/demo',
  target: {
    nodeVersion: '24.13.1',
    platform: 'linux',
    architecture: 'x64',
    libc: 'glibc',
  },
};
const deployment = { id: 'production' };
const profile = {
  schemaVersion: 2,
  kind: 'deploymentProfile',
  profileRevisionId: 'profile-revision',
  appId: 'demo',
  provider: {
    kind: 'aws',
    scope: { region: 'us-east-1' },
  },
};
const providerScope = {
  schemaVersion: 1,
  kind: 'providerScope',
  providerScopeId: 'provider-scope',
  provider: 'aws',
  partition: 'aws',
  accountId: '123456789012',
  region: 'us-east-1',
};
const deploymentRevision = {
  schemaVersion: 1,
  kind: 'deploymentRevision',
  deploymentRevisionId: 'deployment-revision',
  deployment: { id: 'production' },
  appId: 'demo',
  revisionId: 'application-revision',
  artifactId: 'artifact',
  profileRevisionId: 'profile-revision',
};
const proposedPlan = {
  schemaVersion: 3,
  kind: 'deploymentPlan',
  planId: 'plan',
  operation: 'apply',
  deploymentRevision,
  providerScope,
};
const claimedSource = Object.freeze({ close: closeClaimedSource });
const claim = Object.freeze({
  kind: 'opaque-claimed-source',
  source: claimedSource,
});
const intent = {
  schemaVersion: 1,
  kind: 'deploymentArtifactStageIntent',
  stageIntentId: 'intent',
};
const receipt = {
  schemaVersion: 1,
  kind: 'deploymentArtifactStageReceipt',
  stageReceiptId: 'receipt',
};
const stageBundle = { intent, receipt };

function makeRequest(controlPolicy = 'require-active') {
  return {
    packageRequest: JSON.parse(JSON.stringify(packageRequest)),
    deployment: { ...deployment },
    profile: JSON.parse(JSON.stringify(profile)),
    controlPolicy,
  };
}

function makeInvocation() {
  return Object.freeze({
    providerScope: cloneFrozen(providerScope),
    requireControl,
    reconcileControl,
    bootstrapControl,
    plan: planOperation,
    stageClaimedArtifact,
    convergePreStaged,
    close: closeInvocation,
  });
}

function installHappyPath() {
  validateDeploymentProfile.mockImplementation((value) => cloneFrozen(value));
  validateProviderScope.mockImplementation((value) => cloneFrozen(value));
  validateDeploymentPlanContext.mockImplementation((value) =>
    cloneFrozen(value),
  );
  validateDeploymentArtifactStageIntentContext.mockImplementation((value) =>
    cloneFrozen(value),
  );
  validateDeploymentArtifactStageReceiptContext.mockImplementation((value) =>
    cloneFrozen(value),
  );
  packageSelectedSeaArtifact.mockImplementation(() => {
    order.push('package');
    return authority;
  });
  createSelectedSeaDeploymentRevision.mockImplementation(() => {
    order.push('bind');
    return cloneFrozen(deploymentRevision);
  });
  openAwsSingleNodeDeploymentInvocation.mockImplementation(() => {
    order.push('open');
    return makeInvocation();
  });
  requireControl.mockImplementation(() => {
    order.push('requireControl');
  });
  reconcileControl.mockImplementation(() => {
    order.push('reconcileControl');
  });
  bootstrapControl.mockImplementation(() => {
    order.push('bootstrapControl');
  });
  planOperation.mockImplementation(() => {
    order.push('plan');
    return cloneFrozen(proposedPlan);
  });
  claimSelectedSeaArtifactSource.mockImplementation(() => {
    order.push('claim');
    return claim;
  });
  stageClaimedArtifact.mockImplementation(() => {
    order.push('stage');
    return cloneFrozen(stageBundle);
  });
  convergePreStaged.mockImplementation(() => {
    order.push('converge');
    return Object.freeze({ phase: 'READY' });
  });
  discardSelectedSeaArtifact.mockImplementation(() => {
    order.push('discard');
  });
  closeInvocation.mockImplementation(() => {
    order.push('close');
  });
  closeClaimedSource.mockImplementation(() => {
    order.push('closeClaimedSource');
  });
}

/**
 * @param {Promise<any>} promise
 * @returns {Promise<{threw: boolean, error: unknown}>}
 */
async function captureThrown(promise) {
  try {
    await promise;
  } catch (error) {
    return { threw: true, error };
  }
  return { threw: false, error: undefined };
}

beforeEach(() => {
  order.length = 0;
  jest.resetAllMocks();
  installHappyPath();
});

describe('prepareAwsSelectedSeaPlan', () => {
  it('returns only a frozen JSON-safe plan after exact staging and cleanup', async () => {
    const request = makeRequest();

    const prepared = await prepareAwsSelectedSeaPlan(request);

    expect(order).toEqual([
      'package',
      'bind',
      'open',
      'requireControl',
      'plan',
      'claim',
      'stage',
      'close',
    ]);
    expect(Object.keys(prepared)).toEqual(['plan', 'profile', 'artifactStage']);
    expect(Object.keys(prepared.artifactStage)).toEqual(['intent', 'receipt']);
    assertDeepFrozen(prepared);
    expect(JSON.parse(JSON.stringify(prepared))).toEqual(prepared);
    expect(packageSelectedSeaArtifact).toHaveBeenCalledWith(
      request.packageRequest,
    );
    expect(createSelectedSeaDeploymentRevision).toHaveBeenCalledWith(
      authority,
      {
        deployment,
        profile,
      },
    );
    expect(openAwsSingleNodeDeploymentInvocation).toHaveBeenCalledWith({
      region: 'us-east-1',
    });
    expect(
      Object.isFrozen(openAwsSingleNodeDeploymentInvocation.mock.calls[0][0]),
    ).toBe(true);
    expect(planOperation).toHaveBeenCalledWith({
      operation: 'apply',
      deploymentRevision,
      profile,
    });
    expect(claimSelectedSeaArtifactSource).toHaveBeenCalledWith(authority, {
      deploymentRevision,
      profile,
      providerScope,
    });
    expect(stageClaimedArtifact).toHaveBeenCalledWith(claim);
    expect(discardSelectedSeaArtifact).not.toHaveBeenCalled();
  });

  it.each([
    ['require-active', 'requireControl'],
    ['reconcile-existing', 'reconcileControl'],
    ['bootstrap', 'bootstrapControl'],
  ])('selects only the %s control policy method', async (policy, selected) => {
    await prepareAwsSelectedSeaPlan(makeRequest(policy));

    expect(requireControl).toHaveBeenCalledTimes(
      selected === 'requireControl' ? 1 : 0,
    );
    expect(reconcileControl).toHaveBeenCalledTimes(
      selected === 'reconcileControl' ? 1 : 0,
    );
    expect(bootstrapControl).toHaveBeenCalledTimes(
      selected === 'bootstrapControl' ? 1 : 0,
    );
  });

  it('snapshots admission data and enters packaging in the calling turn', async () => {
    const packageGate = deferred();
    /** @type {any} */
    let capturedPackageRequest;
    packageSelectedSeaArtifact.mockImplementation((value) => {
      order.push('package');
      capturedPackageRequest = JSON.parse(JSON.stringify(value));
      return packageGate.promise;
    });
    const request = makeRequest();

    const preparing = prepareAwsSelectedSeaPlan(request);
    request.packageRequest.dir = '/mutated';
    request.packageRequest.target.platform = 'darwin';
    request.deployment.id = 'mutated';
    request.profile.appId = 'mutated';
    request.profile.provider.scope.region = 'eu-west-1';
    request.controlPolicy = 'bootstrap';
    packageGate.resolve(authority);
    await preparing;

    expect(capturedPackageRequest).toEqual(packageRequest);
    expect(createSelectedSeaDeploymentRevision).toHaveBeenCalledWith(
      authority,
      {
        deployment,
        profile,
      },
    );
    expect(openAwsSingleNodeDeploymentInvocation).toHaveBeenCalledWith({
      region: 'us-east-1',
    });
    expect(requireControl).toHaveBeenCalledTimes(1);
    expect(bootstrapControl).not.toHaveBeenCalled();
  });

  it('rejects accessor, extra, and missing admission fields before packaging', async () => {
    const accessed = jest.fn();
    const accessorRequest = {
      packageRequest,
      deployment,
      profile,
    };
    Object.defineProperty(accessorRequest, 'controlPolicy', {
      enumerable: true,
      get() {
        accessed();
        return 'require-active';
      },
    });

    await expect(prepareAwsSelectedSeaPlan(accessorRequest)).rejects.toThrow(
      'AWS selected SEA deployment request is invalid.',
    );
    await expect(
      prepareAwsSelectedSeaPlan({
        ...makeRequest(),
        unsupported: true,
      }),
    ).rejects.toThrow('AWS selected SEA deployment request is invalid.');
    const missing = /** @type {any} */ (makeRequest());
    delete missing.deployment;
    await expect(prepareAwsSelectedSeaPlan(missing)).rejects.toThrow(
      'AWS selected SEA deployment request is invalid.',
    );
    await expect(
      prepareAwsSelectedSeaPlan({
        ...makeRequest(),
        deployment: { id: 'Production' },
      }),
    ).rejects.toThrow('AWS selected SEA deployment request is invalid.');

    expect(accessed).not.toHaveBeenCalled();
    expect(packageSelectedSeaArtifact).not.toHaveBeenCalled();
  });

  it.each([
    [
      'operation',
      /** @param {any} value */ (value) => {
        value.operation = 'destroy';
      },
    ],
    [
      'deployment revision',
      /** @param {any} value */ (value) => {
        value.deploymentRevision.deploymentRevisionId = 'other-revision';
      },
    ],
    [
      'provider scope',
      /** @param {any} value */ (value) => {
        value.providerScope.accountId = '999999999999';
      },
    ],
  ])(
    'rejects a plan with a mismatched %s before claiming',
    async (_name, mutate) => {
      planOperation.mockImplementation(() => {
        order.push('plan');
        const value = JSON.parse(JSON.stringify(proposedPlan));
        mutate(value);
        return value;
      });

      await expect(prepareAwsSelectedSeaPlan(makeRequest())).rejects.toThrow(
        'AWS selected SEA deployment plan is invalid.',
      );

      expect(claimSelectedSeaArtifactSource).not.toHaveBeenCalled();
      expect(stageClaimedArtifact).not.toHaveBeenCalled();
      expect(discardSelectedSeaArtifact).toHaveBeenCalledWith(authority);
      expect(order.slice(-2)).toEqual(['discard', 'close']);
    },
  );

  it('waits for durable staging, including source closure, before closing', async () => {
    const entered = deferred();
    const stageGate = deferred();
    stageClaimedArtifact.mockImplementation(() => {
      order.push('stage');
      entered.resolve();
      return stageGate.promise;
    });

    const preparing = prepareAwsSelectedSeaPlan(makeRequest());
    await entered.promise;
    expect(closeInvocation).not.toHaveBeenCalled();

    stageGate.resolve(cloneFrozen(stageBundle));
    await preparing;
    expect(order.slice(-2)).toEqual(['stage', 'close']);
  });

  it('enters staging in the same turn as the atomic claim', async () => {
    claimSelectedSeaArtifactSource.mockImplementation(() => {
      order.push('claim');
      queueMicrotask(() => order.push('after-claim-microtask'));
      return claim;
    });

    await prepareAwsSelectedSeaPlan(makeRequest());

    expect(order.slice(-4)).toEqual([
      'claim',
      'stage',
      'after-claim-microtask',
      'close',
    ]);
  });

  it('treats stage-result validation as post-claim ownership', async () => {
    stageClaimedArtifact.mockImplementation(() => {
      order.push('stage');
      return { ...stageBundle, unsupported: true };
    });

    await expect(prepareAwsSelectedSeaPlan(makeRequest())).rejects.toThrow(
      'AWS selected SEA artifact stage is invalid.',
    );

    expect(discardSelectedSeaArtifact).not.toHaveBeenCalled();
    expect(closeInvocation).toHaveBeenCalledTimes(1);
  });
});

describe('applyAwsSelectedSea', () => {
  it('stages once and converges the exact prepared bundle', async () => {
    const convergeResult = Object.freeze({
      phase: 'READY',
      deploymentRevisionId: 'deployment-revision',
    });
    convergePreStaged.mockImplementation(() => {
      order.push('converge');
      return convergeResult;
    });

    const result = await applyAwsSelectedSea(makeRequest());

    expect(result).toBe(convergeResult);
    expect(order).toEqual([
      'package',
      'bind',
      'open',
      'requireControl',
      'plan',
      'claim',
      'stage',
      'converge',
      'close',
    ]);
    expect(stageClaimedArtifact).toHaveBeenCalledTimes(1);
    expect(convergePreStaged).toHaveBeenCalledTimes(1);
    const submitted = /** @type {any} */ (convergePreStaged.mock.calls[0][0]);
    expect(Object.keys(submitted)).toEqual([
      'plan',
      'profile',
      'artifactStage',
    ]);
    expect(submitted.plan).toBe(
      validateDeploymentPlanContext.mock.results[0].value,
    );
    expect(submitted.profile).toBe(
      validateDeploymentProfile.mock.results[0].value,
    );
    expect(submitted.artifactStage.intent).toBe(
      validateDeploymentArtifactStageIntentContext.mock.results[0].value,
    );
    expect(submitted.artifactStage.receipt).toBe(
      validateDeploymentArtifactStageReceiptContext.mock.results[0].value,
    );
    assertDeepFrozen(submitted);
  });

  it('keeps a successfully staged artifact owned when convergence fails', async () => {
    const primary = Object.freeze({ code: 'CONVERGE_FAILED' });
    convergePreStaged.mockImplementation(() => {
      order.push('converge');
      return Promise.reject(primary);
    });

    const thrown = await captureThrown(applyAwsSelectedSea(makeRequest()));

    expect(thrown).toEqual({ threw: true, error: primary });
    expect(stageClaimedArtifact).toHaveBeenCalledTimes(1);
    expect(discardSelectedSeaArtifact).not.toHaveBeenCalled();
    expect(order.slice(-3)).toEqual(['stage', 'converge', 'close']);
  });
});

describe('ownership cleanup and failure preservation', () => {
  it.each([
    [
      'binding',
      () => {
        createSelectedSeaDeploymentRevision.mockImplementation(() => {
          order.push('bind');
          throw 'bind failed';
        });
      },
      ['package', 'bind', 'discard'],
      false,
    ],
    [
      'opening',
      () => {
        openAwsSingleNodeDeploymentInvocation.mockImplementation(() => {
          order.push('open');
          return Promise.reject('open failed');
        });
      },
      ['package', 'bind', 'open', 'discard'],
      false,
    ],
    [
      'control',
      () => {
        requireControl.mockImplementation(() => {
          order.push('requireControl');
          return Promise.reject('control failed');
        });
      },
      ['package', 'bind', 'open', 'requireControl', 'discard', 'close'],
      true,
    ],
    [
      'planning',
      () => {
        planOperation.mockImplementation(() => {
          order.push('plan');
          return Promise.reject('plan failed');
        });
      },
      ['package', 'bind', 'open', 'requireControl', 'plan', 'discard', 'close'],
      true,
    ],
    [
      'claiming',
      () => {
        claimSelectedSeaArtifactSource.mockImplementation(() => {
          order.push('claim');
          throw 'claim failed';
        });
      },
      [
        'package',
        'bind',
        'open',
        'requireControl',
        'plan',
        'claim',
        'discard',
        'close',
      ],
      true,
    ],
  ])(
    'discards before claim and closes the invocation last after %s failure',
    async (_name, arrange, expectedOrder, invocationOpened) => {
      arrange();

      const thrown = await captureThrown(
        prepareAwsSelectedSeaPlan(makeRequest()),
      );

      expect(thrown.threw).toBe(true);
      expect(order).toEqual(expectedOrder);
      expect(discardSelectedSeaArtifact).toHaveBeenCalledWith(authority);
      expect(closeInvocation).toHaveBeenCalledTimes(invocationOpened ? 1 : 0);
    },
  );

  it('preserves non-Error primary, discard, and close failures in order', async () => {
    planOperation.mockImplementation(() => {
      order.push('plan');
      return Promise.reject(17);
    });
    discardSelectedSeaArtifact.mockImplementation(() => {
      order.push('discard');
      return Promise.reject('discard failed');
    });
    closeInvocation.mockImplementation(() => {
      order.push('close');
      return Promise.reject(null);
    });

    const thrown = await captureThrown(
      prepareAwsSelectedSeaPlan(makeRequest()),
    );

    expect(thrown.threw).toBe(true);
    expect(thrown.error).toBeInstanceOf(AggregateError);
    expect(/** @type {AggregateError} */ (thrown.error).errors).toEqual([
      17,
      'discard failed',
      null,
    ]);
    expect(order.slice(-2)).toEqual(['discard', 'close']);
  });

  it('never discards after claim and preserves stage then close failures', async () => {
    stageClaimedArtifact.mockImplementation(() => {
      order.push('stage');
      return Promise.reject('stage failed');
    });
    closeInvocation.mockImplementation(() => {
      order.push('close');
      return Promise.reject(undefined);
    });

    const thrown = await captureThrown(
      prepareAwsSelectedSeaPlan(makeRequest()),
    );

    expect(thrown.threw).toBe(true);
    expect(thrown.error).toBeInstanceOf(AggregateError);
    expect(/** @type {AggregateError} */ (thrown.error).errors).toEqual([
      'stage failed',
      undefined,
    ]);
    expect(discardSelectedSeaArtifact).not.toHaveBeenCalled();
    expect(order.slice(-2)).toEqual(['stage', 'close']);
  });

  it('closes the claimed source before the invocation when transfer throws synchronously', async () => {
    stageClaimedArtifact.mockImplementation(() => {
      order.push('stage');
      throw 'synchronous transfer failed';
    });

    const thrown = await captureThrown(
      prepareAwsSelectedSeaPlan(makeRequest()),
    );

    expect(thrown).toEqual({
      threw: true,
      error: 'synchronous transfer failed',
    });
    expect(discardSelectedSeaArtifact).not.toHaveBeenCalled();
    expect(closeClaimedSource).toHaveBeenCalledTimes(1);
    expect(closeClaimedSource.mock.contexts[0]).toBe(claimedSource);
    expect(order.slice(-3)).toEqual(['stage', 'closeClaimedSource', 'close']);
  });

  it('orders synchronous transfer, claimed-source cleanup, and invocation cleanup failures', async () => {
    stageClaimedArtifact.mockImplementation(() => {
      order.push('stage');
      throw 17;
    });
    closeClaimedSource.mockImplementation(() => {
      order.push('closeClaimedSource');
      return Promise.reject(null);
    });
    closeInvocation.mockImplementation(() => {
      order.push('close');
      return Promise.reject(undefined);
    });

    const thrown = await captureThrown(
      prepareAwsSelectedSeaPlan(makeRequest()),
    );

    expect(thrown.threw).toBe(true);
    expect(thrown.error).toBeInstanceOf(AggregateError);
    expect(/** @type {AggregateError} */ (thrown.error).errors).toEqual([
      17,
      null,
      undefined,
    ]);
    expect(order.slice(-3)).toEqual(['stage', 'closeClaimedSource', 'close']);
  });

  it('surfaces a lone close failure after otherwise successful preparation', async () => {
    const closeFailure = Object.freeze({ code: 'CLOSE_FAILED' });
    closeInvocation.mockImplementation(() => {
      order.push('close');
      return Promise.reject(closeFailure);
    });

    const thrown = await captureThrown(
      prepareAwsSelectedSeaPlan(makeRequest()),
    );

    expect(thrown).toEqual({ threw: true, error: closeFailure });
    expect(discardSelectedSeaArtifact).not.toHaveBeenCalled();
  });

  it('does not invent cleanup ownership when packaging fails', async () => {
    packageSelectedSeaArtifact.mockImplementation(() => {
      order.push('package');
      return Promise.reject('package failed');
    });

    const thrown = await captureThrown(
      prepareAwsSelectedSeaPlan(makeRequest()),
    );

    expect(thrown).toEqual({ threw: true, error: 'package failed' });
    expect(order).toEqual(['package']);
    expect(discardSelectedSeaArtifact).not.toHaveBeenCalled();
    expect(closeInvocation).not.toHaveBeenCalled();
  });

  it('uses a captured close when a later invocation method is invalid', async () => {
    openAwsSingleNodeDeploymentInvocation.mockImplementation(() => {
      order.push('open');
      return Object.freeze({
        providerScope: cloneFrozen(providerScope),
        requireControl,
        reconcileControl,
        bootstrapControl,
        stageClaimedArtifact,
        convergePreStaged,
        close: closeInvocation,
      });
    });

    await expect(prepareAwsSelectedSeaPlan(makeRequest())).rejects.toThrow(
      'AWS selected SEA deployment invocation is invalid.',
    );

    expect(order).toEqual(['package', 'bind', 'open', 'discard', 'close']);
  });
});
