import { describe, expect, it, jest } from '@jest/globals';

const INTENT_IMPORT =
  '../../../../src/core/runtime/providers/aws/single-node-provisioning-intent.js';
const EVIDENCE_IMPORT =
  '../../../../src/core/runtime/providers/aws/single-node-evidence.js';
const DESTRUCTION_IMPORT =
  '../../../../src/core/runtime/providers/aws/single-node-destruction.js';
const JOURNAL_EVIDENCE_IMPORT =
  '../../../../src/core/runtime/providers/aws/single-node-journal-evidence.js';

/** @type {jest.Mock<(value: unknown) => Readonly<Record<string, any>>>} */
const validateAwsSingleNodeProvisioningIntent = jest.fn((value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('test provisioning intent is invalid');
  }
  return /** @type {Readonly<Record<string, any>>} */ (value);
});

class AwsSingleNodeEvidenceConflictError extends Error {}
class AwsSingleNodeEvidenceTransientError extends Error {}
class AwsSingleNodeEvidenceUnknownError extends Error {}

/** @type {jest.Mock<(value: unknown) => Promise<Readonly<Record<string, any>>>>} */
const inspectAwsSingleNodeInstance = jest.fn();
/** @type {jest.Mock<(value: unknown) => Promise<Readonly<Record<string, any>>>>} */
const inspectAwsSingleNodeRootVolume = jest.fn();
/** @type {jest.Mock<(value: unknown) => Promise<Readonly<Record<string, any>>>>} */
const inspectAwsSingleNodeSecurityGroup = jest.fn();

jest.unstable_mockModule(INTENT_IMPORT, () => ({
  validateAwsSingleNodeProvisioningIntent,
}));
jest.unstable_mockModule(EVIDENCE_IMPORT, () => ({
  AwsSingleNodeEvidenceConflictError,
  AwsSingleNodeEvidenceTransientError,
  AwsSingleNodeEvidenceUnknownError,
  inspectAwsSingleNodeInstance,
  inspectAwsSingleNodeRootVolume,
  inspectAwsSingleNodeSecurityGroup,
}));

const {
  AWS_SINGLE_NODE_DESTRUCTION_DEADLINE_MILLISECONDS,
  AwsSingleNodeDestructionConflictError,
  AwsSingleNodeDestructionTimeoutError,
  AwsSingleNodeDestructionTransientError,
  createAwsSingleNodeDestructionConverger,
} = await import(DESTRUCTION_IMPORT);
const { createAwsDeletionRecord, createAwsDestructionAttempt } = await import(
  JOURNAL_EVIDENCE_IMPORT
);

const IDS = Object.freeze({
  instance: 'i-0123456789abcdef0',
  rootVolume: 'vol-0123456789abcdef0',
  securityGroup: 'sg-0123456789abcdef0',
});
const EMPTY_EVIDENCE = Object.freeze({
  instance: null,
  rootVolume: null,
  securityGroup: null,
});
const INTENT = Object.freeze({
  schemaVersion: 1,
  kind: 'awsSingleNodeProvisioningIntent',
  provisioningIntentId: 'wsapi1_test-provisioning-intent',
  incarnationId: 'wsni1_test-incarnation',
  plan: Object.freeze({
    schemaVersion: 1,
    kind: 'awsSingleNodeDeploymentPlan',
    planId: 'wsap1_test-plan',
    deploymentInstanceId: 'wsndi1_test-deployment',
    providerSpec: Object.freeze({
      providerSpecId: 'wsas1_test-provider-spec',
      providerScope: Object.freeze({
        providerScopeId: 'wps1_test-provider-scope',
      }),
    }),
    actions: Object.freeze([
      Object.freeze({
        kind: 'provision-managed-node',
        actionId: 'wsaa1_test-provision-action',
      }),
    ]),
  }),
});

/** @param {'absent'|'present'|'terminal'} status @param {Record<string, any>} [overrides] */
function instanceObservation(status, overrides = {}) {
  if (status === 'absent') {
    return Object.freeze({
      status,
      ownershipStatus: 'absent',
      specStatus: 'absent',
      instanceId: null,
      instanceState: null,
      rootVolumeId: null,
      publicIpv4: null,
      ...overrides,
    });
  }
  return Object.freeze({
    status,
    ownershipStatus: 'owned',
    specStatus: 'exact',
    instanceId: IDS.instance,
    instanceState: status === 'terminal' ? 'terminated' : 'running',
    rootVolumeId: IDS.rootVolume,
    publicIpv4: status === 'terminal' ? null : '198.51.100.7',
    ...overrides,
  });
}

/** @param {'absent'|'present'|'settling'|'available'|'deleting'} status @param {Record<string, any>} [overrides] */
function rootObservation(status, overrides = {}) {
  if (status === 'absent') {
    return Object.freeze({
      status,
      ownershipStatus: 'absent',
      specStatus: 'absent',
      volumeId: null,
      volumeState: null,
      attachmentStatus: null,
      ...overrides,
    });
  }
  const attachmentStatus =
    status === 'available' || status === 'deleting' ? 'none' : 'expected';
  const volumeState =
    status === 'available'
      ? 'available'
      : status === 'deleting'
        ? 'deleting'
        : status === 'settling'
          ? 'creating'
          : 'in-use';
  return Object.freeze({
    status,
    ownershipStatus: 'owned',
    specStatus: status === 'settling' ? 'incomplete' : 'exact',
    volumeId: IDS.rootVolume,
    volumeState,
    attachmentStatus,
    ...overrides,
  });
}

/** @param {'absent'|'present'} status @param {Record<string, any>} [overrides] */
function securityGroupObservation(status, overrides = {}) {
  if (status === 'absent') {
    return Object.freeze({
      status,
      ownershipStatus: 'absent',
      specStatus: 'absent',
      securityGroupId: null,
      missingIpv4: [],
      ...overrides,
    });
  }
  return Object.freeze({
    status,
    ownershipStatus: 'owned',
    specStatus: 'exact',
    securityGroupId: IDS.securityGroup,
    missingIpv4: [],
    ...overrides,
  });
}

/** @param {unknown} value @returns {boolean} */
function deeplyFrozen(value) {
  return (
    value === null ||
    typeof value !== 'object' ||
    (Object.isFrozen(value) && Object.values(value).every(deeplyFrozen))
  );
}

/**
 * @param {{
 *   instance?: Readonly<Record<string, any>>,
 *   rootVolume?: Readonly<Record<string, any>>,
 *   securityGroup?: Readonly<Record<string, any>>,
 *   keepRootAttached?: boolean,
 *   lostResponses?: string[],
 *   noEffect?: string[],
 *   releaseRootOnSleep?: boolean,
 *   sleepToDeadline?: boolean,
 *   attemptFailure?: boolean,
 * }} [options]
 */
function makeProvider(options = {}) {
  const events = /** @type {string[]} */ ([]);
  const attempts = /** @type {Readonly<Record<string, any>>[]} */ ([]);
  const deletions = /** @type {Readonly<Record<string, any>>[]} */ ([]);
  const state = {
    instance: options.instance ?? instanceObservation('present'),
    rootVolume: options.rootVolume ?? rootObservation('present'),
    securityGroup: options.securityGroup ?? securityGroupObservation('present'),
  };
  let current = 0;
  const lostResponses = new Set(options.lostResponses ?? []);
  const noEffect = new Set(options.noEffect ?? []);

  inspectAwsSingleNodeInstance.mockClear();
  inspectAwsSingleNodeRootVolume.mockClear();
  inspectAwsSingleNodeSecurityGroup.mockClear();
  inspectAwsSingleNodeInstance.mockImplementation(
    /** @this {unknown} */ async function (value) {
      expect(this).toBeUndefined();
      events.push('inspect:instance');
      expect(Object.isFrozen(value)).toBe(true);
      return state.instance;
    },
  );
  inspectAwsSingleNodeRootVolume.mockImplementation(
    /** @this {unknown} */ async function (value) {
      expect(this).toBeUndefined();
      events.push('inspect:rootVolume');
      expect(Object.isFrozen(value)).toBe(true);
      return state.rootVolume;
    },
  );
  inspectAwsSingleNodeSecurityGroup.mockImplementation(
    /** @this {unknown} */ async function (value) {
      expect(this).toBeUndefined();
      events.push('inspect:securityGroup');
      expect(Object.isFrozen(value)).toBe(true);
      return state.securityGroup;
    },
  );

  const api = {
    describeSecurityGroups: jest.fn(
      /** @this {unknown} */ async function () {
        expect(this).toBeUndefined();
        throw new Error('mock inspector owns reads');
      },
    ),
    describeInstanceAttribute: jest.fn(
      /** @this {unknown} */ async function () {
        expect(this).toBeUndefined();
        throw new Error('mock inspector owns reads');
      },
    ),
    describeInstanceCreditSpecifications: jest.fn(
      /** @this {unknown} */ async function () {
        expect(this).toBeUndefined();
        throw new Error('mock inspector owns reads');
      },
    ),
    describeInstances: jest.fn(
      /** @this {unknown} */ async function () {
        expect(this).toBeUndefined();
        throw new Error('mock inspector owns reads');
      },
    ),
    describeVolumes: jest.fn(
      /** @this {unknown} */ async function () {
        expect(this).toBeUndefined();
        throw new Error('mock inspector owns reads');
      },
    ),
    terminateInstances: jest.fn(
      /**
       * @this {unknown}
       * @param {Record<string, any>} request
       */
      async function (request) {
        expect(this).toBeUndefined();
        events.push('mutate:instance');
        expect(request).toEqual({
          InstanceIds: [IDS.instance],
          Force: false,
          SkipOsShutdown: false,
        });
        if (!noEffect.has('instance')) {
          state.instance = instanceObservation('terminal');
          state.rootVolume = options.keepRootAttached
            ? rootObservation('present')
            : rootObservation('available');
        }
        if (lostResponses.has('instance')) {
          throw new Error('transport contained aws-secret-instance');
        }
        return { unsafeProviderDetail: 'ignored' };
      },
    ),
    deleteVolume: jest.fn(
      /**
       * @this {unknown}
       * @param {Record<string, any>} request
       */
      async function (request) {
        expect(this).toBeUndefined();
        events.push('mutate:rootVolume');
        expect(request).toEqual({ VolumeId: IDS.rootVolume });
        if (!noEffect.has('rootVolume')) {
          state.rootVolume = rootObservation('absent');
        }
        if (lostResponses.has('rootVolume')) {
          throw new Error('transport contained aws-secret-volume');
        }
        return { unsafeProviderDetail: 'ignored' };
      },
    ),
    deleteSecurityGroup: jest.fn(
      /**
       * @this {unknown}
       * @param {Record<string, any>} request
       */
      async function (request) {
        expect(this).toBeUndefined();
        events.push('mutate:securityGroup');
        expect(request).toEqual({ GroupId: IDS.securityGroup });
        if (!noEffect.has('securityGroup')) {
          state.securityGroup = securityGroupObservation('absent');
        }
        if (lostResponses.has('securityGroup')) {
          throw new Error('transport contained aws-secret-group');
        }
        return { unsafeProviderDetail: 'ignored' };
      },
    ),
  };
  const recordDestroyAttempt = jest.fn(
    /**
     * @this {unknown}
     * @param {Readonly<Record<string, any>>} attempt
     */
    async function (attempt) {
      expect(this).toBeUndefined();
      events.push(`attempt:${attempt.role}`);
      attempts.push(attempt);
      if (options.attemptFailure) {
        throw new Error('storage contained aws-secret-callback');
      }
    },
  );
  const recordDeletion = jest.fn(
    /**
     * @this {unknown}
     * @param {Readonly<Record<string, any>>} deletion
     */
    async function (deletion) {
      expect(this).toBeUndefined();
      events.push(`deletion:${deletion.role}`);
      deletions.push(deletion);
    },
  );
  const now = jest.fn(
    /** @this {unknown} */ function () {
      expect(this).toBeUndefined();
      return current;
    },
  );
  const sleep = jest.fn(
    /**
     * @this {unknown}
     * @param {number} milliseconds
     */
    async function (milliseconds) {
      expect(this).toBeUndefined();
      events.push(`sleep:${milliseconds}`);
      current += options.sleepToDeadline
        ? AWS_SINGLE_NODE_DESTRUCTION_DEADLINE_MILLISECONDS
        : milliseconds;
      if (options.releaseRootOnSleep && state.rootVolume.status !== 'absent') {
        state.rootVolume = rootObservation('available');
      }
    },
  );
  const converge = createAwsSingleNodeDestructionConverger({ now, sleep });
  return {
    api,
    attempts,
    converge,
    deletions,
    events,
    now,
    recordDeletion,
    recordDestroyAttempt,
    sleep,
    state,
  };
}

/** @param {ReturnType<typeof makeProvider>} provider @param {Record<string, any>} [overrides] */
function convergenceInput(provider, overrides = {}) {
  return {
    intent: INTENT,
    storedResourceIds: IDS,
    storedDestroyAttempts: EMPTY_EVIDENCE,
    storedDeletionRecords: EMPTY_EVIDENCE,
    api: provider.api,
    recordDestroyAttempt: provider.recordDestroyAttempt,
    recordDeletion: provider.recordDeletion,
    ...overrides,
  };
}

describe('AWS single-node destruction convergence', () => {
  it('fences, deletes, proves absence, and records in strict dependency order', async () => {
    const provider = makeProvider();
    const result = await provider.converge(convergenceInput(provider));

    expect(provider.events).toEqual([
      'inspect:instance',
      'attempt:instance',
      'mutate:instance',
      'inspect:instance',
      'deletion:instance',
      'inspect:rootVolume',
      'attempt:rootVolume',
      'mutate:rootVolume',
      'inspect:rootVolume',
      'deletion:rootVolume',
      'inspect:securityGroup',
      'attempt:securityGroup',
      'mutate:securityGroup',
      'inspect:securityGroup',
      'deletion:securityGroup',
    ]);
    expect(result).toMatchObject({
      kind: 'awsSingleNodeDestructionResult',
      status: 'destroyed',
      resources: {
        instance: {
          providerResourceId: IDS.instance,
          state: 'absent',
        },
        rootVolume: {
          providerResourceId: IDS.rootVolume,
          state: 'absent',
        },
        securityGroup: {
          providerResourceId: IDS.securityGroup,
          state: 'absent',
        },
      },
    });
    expect(deeplyFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/secret|credential/iu);
  });

  it('does nothing for null never-created IDs and returns null deletions', async () => {
    const provider = makeProvider();
    const result = await provider.converge(
      convergenceInput(provider, {
        storedResourceIds: {
          instance: null,
          rootVolume: null,
          securityGroup: null,
        },
      }),
    );

    expect(inspectAwsSingleNodeInstance).not.toHaveBeenCalled();
    expect(inspectAwsSingleNodeRootVolume).not.toHaveBeenCalled();
    expect(inspectAwsSingleNodeSecurityGroup).not.toHaveBeenCalled();
    expect(provider.recordDestroyAttempt).not.toHaveBeenCalled();
    expect(provider.recordDeletion).not.toHaveBeenCalled();
    expect(provider.api.terminateInstances).not.toHaveBeenCalled();
    expect(provider.api.deleteVolume).not.toHaveBeenCalled();
    expect(provider.api.deleteSecurityGroup).not.toHaveBeenCalled();
    expect(provider.now).not.toHaveBeenCalled();
    expect(result.resources).toEqual({
      instance: {
        providerResourceId: null,
        state: 'absent',
        deletionId: null,
      },
      rootVolume: {
        providerResourceId: null,
        state: 'absent',
        deletionId: null,
      },
      securityGroup: {
        providerResourceId: null,
        state: 'absent',
        deletionId: null,
      },
    });
  });

  it('records terminal and already auto-deleted resources without new fences', async () => {
    const provider = makeProvider({
      instance: instanceObservation('terminal', {
        instanceState: 'shutting-down',
      }),
      rootVolume: rootObservation('absent'),
      securityGroup: securityGroupObservation('absent'),
    });

    await provider.converge(convergenceInput(provider));

    expect(provider.recordDestroyAttempt).not.toHaveBeenCalled();
    expect(provider.api.terminateInstances).not.toHaveBeenCalled();
    expect(provider.api.deleteVolume).not.toHaveBeenCalled();
    expect(provider.api.deleteSecurityGroup).not.toHaveBeenCalled();
    expect(provider.deletions).toHaveLength(3);
    expect(
      provider.deletions.every(
        (deletion) => deletion.destroyAttemptId === null,
      ),
    ).toBe(true);
  });

  it('terminates stopped instances instead of treating them as absent', async () => {
    const provider = makeProvider({
      instance: instanceObservation('present', {
        instanceState: 'stopped',
        specStatus: 'conflict',
      }),
    });

    await provider.converge(convergenceInput(provider));

    expect(provider.api.terminateInstances).toHaveBeenCalledTimes(1);
    expect(provider.events.indexOf('attempt:instance')).toBeLessThan(
      provider.events.indexOf('mutate:instance'),
    );
  });

  it('recovers every lost mutation response only through exact readback', async () => {
    const provider = makeProvider({
      lostResponses: ['instance', 'rootVolume', 'securityGroup'],
    });

    const result = await provider.converge(convergenceInput(provider));

    expect(result.status).toBe('destroyed');
    expect(provider.deletions).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain('aws-secret');
  });

  it('waits for an expected root attachment to release before deletion', async () => {
    const provider = makeProvider({
      keepRootAttached: true,
      releaseRootOnSleep: true,
    });

    await provider.converge(convergenceInput(provider));

    const sleepIndex = provider.events.findIndex((event) =>
      event.startsWith('sleep:'),
    );
    expect(sleepIndex).toBeGreaterThan(
      provider.events.indexOf('inspect:rootVolume'),
    );
    expect(provider.events.indexOf('attempt:rootVolume')).toBeGreaterThan(
      sleepIndex,
    );
    expect(provider.events.indexOf('mutate:rootVolume')).toBeGreaterThan(
      provider.events.indexOf('attempt:rootVolume'),
    );
  });

  it('fails closed on an unexpected root attachment without dependent effects', async () => {
    const provider = makeProvider({
      keepRootAttached: true,
      rootVolume: rootObservation('present', {
        specStatus: 'conflict',
        attachmentStatus: 'unexpected',
      }),
    });
    provider.api.terminateInstances.mockImplementationOnce(async () => {
      provider.events.push('mutate:instance');
      provider.state.instance = instanceObservation('terminal');
      provider.state.rootVolume = rootObservation('present', {
        specStatus: 'conflict',
        attachmentStatus: 'unexpected',
      });
      return { unsafeProviderDetail: 'ignored' };
    });

    await expect(
      provider.converge(convergenceInput(provider)),
    ).rejects.toMatchObject({
      code: 'AWS_SINGLE_NODE_DESTRUCTION_CONFLICT',
      role: 'rootVolume',
      reason: 'unexpected-attachment',
    });
    expect(provider.api.deleteVolume).not.toHaveBeenCalled();
    expect(provider.api.deleteSecurityGroup).not.toHaveBeenCalled();
  });

  it('allows exactly owned fixed-spec drift to be purged', async () => {
    const provider = makeProvider({
      instance: instanceObservation('present', { specStatus: 'conflict' }),
      rootVolume: rootObservation('available', { specStatus: 'conflict' }),
      securityGroup: securityGroupObservation('present', {
        specStatus: 'conflict',
      }),
    });
    provider.api.terminateInstances.mockImplementationOnce(async () => {
      provider.events.push('mutate:instance');
      provider.state.instance = instanceObservation('terminal', {
        specStatus: 'conflict',
      });
      provider.state.rootVolume = rootObservation('available', {
        specStatus: 'conflict',
      });
      return { unsafeProviderDetail: 'ignored' };
    });

    await expect(
      provider.converge(convergenceInput(provider)),
    ).resolves.toMatchObject({ status: 'destroyed' });
    expect(provider.api.terminateInstances).toHaveBeenCalledTimes(1);
    expect(provider.api.deleteVolume).toHaveBeenCalledTimes(1);
    expect(provider.api.deleteSecurityGroup).toHaveBeenCalledTimes(1);
  });

  it('never mutates unowned or ambiguous instance evidence', async () => {
    const unowned = makeProvider({
      instance: instanceObservation('present', {
        ownershipStatus: 'absent',
      }),
    });
    await expect(
      unowned.converge(convergenceInput(unowned)),
    ).rejects.toMatchObject({
      code: 'AWS_SINGLE_NODE_DESTRUCTION_CONFLICT',
      role: 'instance',
      reason: 'ownership-mismatch',
    });
    expect(unowned.recordDestroyAttempt).not.toHaveBeenCalled();
    expect(unowned.api.terminateInstances).not.toHaveBeenCalled();

    const ambiguous = makeProvider();
    inspectAwsSingleNodeInstance.mockRejectedValueOnce(
      new AwsSingleNodeEvidenceConflictError('unsafe provider detail'),
    );
    await expect(
      ambiguous.converge(convergenceInput(ambiguous)),
    ).rejects.toMatchObject({
      code: 'AWS_SINGLE_NODE_DESTRUCTION_CONFLICT',
      role: 'instance',
      reason: 'ownership-ambiguity',
    });
    expect(ambiguous.recordDestroyAttempt).not.toHaveBeenCalled();
    expect(ambiguous.api.terminateInstances).not.toHaveBeenCalled();
  });

  it('reuses stored attempts without refencing and validates stored deletions', async () => {
    const provider = makeProvider();
    const instanceAttempt = createAwsDestructionAttempt(
      INTENT,
      'instance',
      IDS.instance,
    );
    await provider.converge(
      convergenceInput(provider, {
        storedDestroyAttempts: {
          ...EMPTY_EVIDENCE,
          instance: instanceAttempt,
        },
      }),
    );
    expect(provider.recordDestroyAttempt).toHaveBeenCalledTimes(2);
    expect(provider.recordDestroyAttempt).not.toHaveBeenCalledWith(
      instanceAttempt,
    );
    expect(provider.events.indexOf('mutate:instance')).toBeLessThan(
      provider.events.indexOf('attempt:rootVolume'),
    );

    const absent = makeProvider({
      instance: instanceObservation('absent'),
      rootVolume: rootObservation('absent'),
      securityGroup: securityGroupObservation('absent'),
    });
    const storedDeletionRecords = Object.fromEntries(
      Object.entries(IDS).map(([role, id]) => [
        role,
        createAwsDeletionRecord(INTENT, role, id, null),
      ]),
    );
    const result = await absent.converge(
      convergenceInput(absent, { storedDeletionRecords }),
    );
    expect(absent.recordDeletion).not.toHaveBeenCalled();
    expect(absent.recordDestroyAttempt).not.toHaveBeenCalled();
    expect(absent.api.terminateInstances).not.toHaveBeenCalled();
    expect(result.resources.instance.deletionId).toBe(
      storedDeletionRecords.instance.deletionId,
    );
  });

  it('retries transient evidence reads but stops on unknown evidence', async () => {
    const transient = makeProvider({
      instance: instanceObservation('absent'),
      rootVolume: rootObservation('absent'),
      securityGroup: securityGroupObservation('absent'),
    });
    inspectAwsSingleNodeInstance.mockRejectedValueOnce(
      new AwsSingleNodeEvidenceTransientError('unsafe transient detail'),
    );
    await expect(
      transient.converge(convergenceInput(transient)),
    ).resolves.toMatchObject({ status: 'destroyed' });
    expect(transient.sleep).toHaveBeenCalledTimes(1);

    const unknown = makeProvider();
    inspectAwsSingleNodeInstance.mockRejectedValueOnce(
      new AwsSingleNodeEvidenceUnknownError('unsafe unknown detail'),
    );
    const failure = await unknown
      .converge(convergenceInput(unknown))
      .catch((/** @type {unknown} */ error) => error);
    expect(failure).toBeInstanceOf(AwsSingleNodeDestructionConflictError);
    expect(failure).toMatchObject({
      reason: 'unknown-evidence',
      role: 'instance',
    });
    expect(JSON.stringify(failure)).not.toContain('unsafe unknown detail');
  });

  it('times out bounded dependency retries without a real wait', async () => {
    const provider = makeProvider({
      instance: instanceObservation('absent'),
      rootVolume: rootObservation('absent'),
      noEffect: ['securityGroup'],
      sleepToDeadline: true,
    });
    const input = convergenceInput(provider, {
      storedResourceIds: {
        instance: null,
        rootVolume: null,
        securityGroup: IDS.securityGroup,
      },
    });

    await expect(provider.converge(input)).rejects.toBeInstanceOf(
      AwsSingleNodeDestructionTimeoutError,
    );
    expect(provider.api.deleteSecurityGroup).toHaveBeenCalledTimes(1);
    expect(provider.recordDeletion).not.toHaveBeenCalled();
  });

  it('sanitizes durable callback failures and never mutates before a fence', async () => {
    const provider = makeProvider({ attemptFailure: true });
    const failure = await provider
      .converge(convergenceInput(provider))
      .catch((/** @type {unknown} */ error) => error);

    expect(failure).toBeInstanceOf(AwsSingleNodeDestructionTransientError);
    expect(failure).toMatchObject({
      code: 'AWS_SINGLE_NODE_DESTRUCTION_TRANSIENT',
      role: 'instance',
      operation: 'record-destroy-attempt',
    });
    expect(provider.api.terminateInstances).not.toHaveBeenCalled();
    expect(JSON.stringify(failure)).not.toContain('aws-secret-callback');
  });

  it('rejects accessors without invoking them and calls capabilities receiver-free', async () => {
    const provider = makeProvider({
      keepRootAttached: true,
      releaseRootOnSleep: true,
    });
    await expect(
      provider.converge(convergenceInput(provider)),
    ).resolves.toMatchObject({ status: 'destroyed' });

    let inputGetterCalls = 0;
    const accessorInput = convergenceInput(provider);
    Object.defineProperty(accessorInput, 'intent', {
      enumerable: true,
      get() {
        inputGetterCalls += 1;
        throw new Error('accessor secret');
      },
    });
    await expect(provider.converge(accessorInput)).rejects.toThrow(
      /own data field/iu,
    );
    expect(inputGetterCalls).toBe(0);

    let apiGetterCalls = 0;
    const accessorApi = { ...provider.api };
    Object.defineProperty(accessorApi, 'deleteSecurityGroup', {
      enumerable: true,
      get() {
        apiGetterCalls += 1;
        throw new Error('api accessor secret');
      },
    });
    await expect(
      provider.converge(
        convergenceInput(provider, {
          api: accessorApi,
          storedResourceIds: {
            instance: null,
            rootVolume: null,
            securityGroup: null,
          },
        }),
      ),
    ).rejects.toThrow(/deleteSecurityGroup is required/iu);
    expect(apiGetterCalls).toBe(0);
  });
});
