import { describe, expect, it, jest } from '@jest/globals';

import { createAwsProviderScope } from '../../../../src/core/runtime/deployment-provider-scope.js';
import { AwsSingleNodeEvidenceTransientError } from '../../../../src/core/runtime/providers/aws/single-node-evidence.js';

const JOURNAL_IMPORT =
  '../../../../src/core/runtime/single-node-deployment-journal.js';
const STATUS_IMPORT =
  '../../../../src/core/runtime/providers/aws/single-node-status.js';

/** @type {jest.Mock<(value: unknown) => Readonly<Record<string, any>>>} */
const validateSingleNodeDeploymentJournal = jest.fn(
  (value) => /** @type {Readonly<Record<string, any>>} */ (value),
);

jest.unstable_mockModule(JOURNAL_IMPORT, () => ({
  validateSingleNodeDeploymentJournal,
}));

const {
  AwsSingleNodeStatusReadError,
  AwsSingleNodeStatusScopeError,
  createAwsSingleNodeStatusFactory,
} = await import(STATUS_IMPORT);

const REGION = 'us-east-2';
const SCOPE = createAwsProviderScope({
  partition: 'aws',
  accountId: '123456789012',
  region: REGION,
});
const OTHER_SCOPE = createAwsProviderScope({
  partition: 'aws',
  accountId: '210987654321',
  region: REGION,
});
const IDS = Object.freeze({
  securityGroup: 'sg-0123456789abcdef0',
  instance: 'i-0123456789abcdef0',
  rootVolume: 'vol-0123456789abcdef0',
});
const OTHER_SECURITY_GROUP_ID = 'sg-1123456789abcdef0';
const PUBLIC_IPV4 = '203.0.113.40';
const READ_METHODS = Object.freeze([
  'describeSecurityGroups',
  'describeInstanceAttribute',
  'describeInstances',
  'describeVolumes',
  'describeInstanceCreditSpecifications',
]);

/** @param {any} value @returns {boolean} */
function deeplyFrozen(value) {
  return (
    value === null ||
    typeof value !== 'object' ||
    (Object.isFrozen(value) && Object.values(value).every(deeplyFrozen))
  );
}

function presentResources() {
  return [
    {
      role: 'securityGroup',
      providerResourceId: IDS.securityGroup,
      state: 'present',
      publicIpv4: null,
    },
    {
      role: 'instance',
      providerResourceId: IDS.instance,
      state: 'present',
      publicIpv4: PUBLIC_IPV4,
    },
    {
      role: 'rootVolume',
      providerResourceId: IDS.rootVolume,
      state: 'present',
      publicIpv4: null,
    },
  ];
}

/**
 * @param {{phase?: string, resources?: any[], mutationAttempts?: any[]}} [value]
 */
function makeJournal(value = {}) {
  return Object.freeze({
    phase: value.phase ?? 'active',
    deploymentInstanceId: 'wsnd1_test-status-deployment',
    providerIntent: Object.freeze({
      provider: 'aws',
      intent: Object.freeze({
        plan: Object.freeze({
          providerSpec: Object.freeze({ providerScope: SCOPE }),
        }),
      }),
    }),
    resources: Object.freeze(value.resources ?? presentResources()),
    mutationAttempts: Object.freeze(value.mutationAttempts ?? []),
  });
}

/** @param {string} [id] */
function exactSecurityGroup(id = IDS.securityGroup) {
  return Object.freeze({
    status: 'present',
    ownershipStatus: 'owned',
    specStatus: 'exact',
    securityGroupId: id,
    missingIpv4: Object.freeze([]),
  });
}

function absentSecurityGroup() {
  return Object.freeze({
    status: 'absent',
    ownershipStatus: 'absent',
    specStatus: 'absent',
    securityGroupId: null,
    missingIpv4: Object.freeze([]),
  });
}

function exactInstance() {
  return Object.freeze({
    status: 'present',
    ownershipStatus: 'owned',
    specStatus: 'exact',
    instanceId: IDS.instance,
    instanceState: 'running',
    rootVolumeId: IDS.rootVolume,
    publicIpv4: PUBLIC_IPV4,
  });
}

function absentInstance() {
  return Object.freeze({
    status: 'absent',
    ownershipStatus: 'absent',
    specStatus: 'absent',
    instanceId: null,
    instanceState: null,
    rootVolumeId: null,
    publicIpv4: null,
  });
}

/** @param {'shutting-down'|'terminated'} instanceState */
function terminalInstance(instanceState) {
  return Object.freeze({
    status: 'terminal',
    ownershipStatus: 'owned',
    specStatus: 'incomplete',
    instanceId: IDS.instance,
    instanceState,
    rootVolumeId: IDS.rootVolume,
    publicIpv4: null,
  });
}

function exactRootVolume() {
  return Object.freeze({
    status: 'present',
    ownershipStatus: 'owned',
    specStatus: 'exact',
    volumeId: IDS.rootVolume,
    volumeState: 'in-use',
    attachmentStatus: 'expected',
  });
}

function absentRootVolume() {
  return Object.freeze({
    status: 'absent',
    ownershipStatus: 'absent',
    specStatus: 'absent',
    volumeId: null,
    volumeState: null,
    attachmentStatus: null,
  });
}

/**
 * @param {{resolvedScope?: Readonly<Record<string, any>>, openError?: Error, closeError?: Error, inspectSecurityGroup?: Function, inspectInstance?: Function, inspectRootVolume?: Function}} [options]
 */
function makePorts(options = {}) {
  let mutationCapabilityRead = false;
  const api = Object.fromEntries(
    READ_METHODS.map((method) => [method, jest.fn(async () => ({ method }))]),
  );
  Object.defineProperty(api, 'terminateInstances', {
    enumerable: true,
    get() {
      mutationCapabilityRead = true;
      throw new Error('mutation capability must remain unreachable');
    },
  });
  const close = jest.fn(async () => {
    if (options.closeError) throw options.closeError;
  });
  const resolveScope = jest.fn(async () => options.resolvedScope ?? SCOPE);
  const authority = Object.freeze({
    schemaVersion: 1,
    kind: 'awsSingleNodeReadAuthority',
    providerScope: SCOPE,
    api,
    resolveScope,
    close,
  });
  const createReadAuthority = jest.fn(async (/** @type {unknown} */ _input) => {
    if (options.openError) throw options.openError;
    return authority;
  });
  const inspectSecurityGroup = jest.fn(
    async (/** @type {unknown} */ inspection) =>
      options.inspectSecurityGroup
        ? await Reflect.apply(options.inspectSecurityGroup, undefined, [
            inspection,
          ])
        : exactSecurityGroup(),
  );
  const inspectInstance = jest.fn(async (/** @type {unknown} */ inspection) =>
    options.inspectInstance
      ? await Reflect.apply(options.inspectInstance, undefined, [inspection])
      : exactInstance(),
  );
  const inspectRootVolume = jest.fn(
    async (/** @type {unknown} */ inspection) =>
      options.inspectRootVolume
        ? await Reflect.apply(options.inspectRootVolume, undefined, [
            inspection,
          ])
        : exactRootVolume(),
  );
  return {
    dependencies: {
      createReadAuthority,
      inspectSecurityGroup,
      inspectInstance,
      inspectRootVolume,
    },
    spies: {
      createReadAuthority,
      inspectSecurityGroup,
      inspectInstance,
      inspectRootVolume,
      resolveScope,
      close,
      mutationCapabilityWasRead: () => mutationCapabilityRead,
    },
  };
}

describe('AWS single-node deployment status', () => {
  it('reports exact active state through only the five read capabilities', async () => {
    const { dependencies, spies } = makePorts();
    const inspect = createAwsSingleNodeStatusFactory(dependencies);

    await expect(inspect({ journal: makeJournal() })).resolves.toEqual({
      status: 'exact',
      resources: [
        {
          role: 'instance',
          id: IDS.instance,
          state: 'exact',
          publicIpv4: PUBLIC_IPV4,
        },
        {
          role: 'root-volume',
          id: IDS.rootVolume,
          state: 'exact',
          publicIpv4: null,
        },
        {
          role: 'security-group',
          id: IDS.securityGroup,
          state: 'exact',
          publicIpv4: null,
        },
      ],
    });

    expect(spies.createReadAuthority).toHaveBeenCalledWith({ region: REGION });
    expect(spies.resolveScope).toHaveBeenCalledTimes(1);
    expect(spies.close).toHaveBeenCalledTimes(1);
    expect(spies.mutationCapabilityWasRead()).toBe(false);
    for (const inspectResource of [
      spies.inspectSecurityGroup,
      spies.inspectInstance,
      spies.inspectRootVolume,
    ]) {
      const inspection = /** @type {Record<string, any>} */ (
        inspectResource.mock.calls[0][0]
      );
      expect(Object.keys(inspection.api)).toEqual(READ_METHODS);
      expect(Object.isFrozen(inspection.api)).toBe(true);
    }
    const result = await inspect({ journal: makeJournal() });
    expect(deeplyFrozen(result)).toBe(true);
    expect(spies.close).toHaveBeenCalledTimes(2);
  });

  it('reports exact destroyed state after provider-confirmed absence', async () => {
    const { dependencies, spies } = makePorts({
      inspectSecurityGroup: async () => absentSecurityGroup(),
      inspectInstance: async () => absentInstance(),
      inspectRootVolume: async () => absentRootVolume(),
    });
    const journal = makeJournal({
      phase: 'destroyed',
      resources: presentResources().map((resource) => ({
        ...resource,
        state: 'absent',
      })),
    });

    await expect(
      createAwsSingleNodeStatusFactory(dependencies)({ journal }),
    ).resolves.toEqual({
      status: 'exact',
      resources: [
        {
          role: 'instance',
          id: IDS.instance,
          state: 'absent',
          publicIpv4: null,
        },
        {
          role: 'root-volume',
          id: IDS.rootVolume,
          state: 'absent',
          publicIpv4: null,
        },
        {
          role: 'security-group',
          id: IDS.securityGroup,
          state: 'absent',
          publicIpv4: null,
        },
      ],
    });
    expect(spies.close).toHaveBeenCalledTimes(1);
  });

  it.each(['shutting-down', 'terminated'])(
    'treats a destroyed journal plus an owned %s tombstone as exact absence',
    async (instanceState) => {
      const { dependencies, spies } = makePorts({
        inspectSecurityGroup: async () => absentSecurityGroup(),
        inspectInstance: async () =>
          terminalInstance(
            /** @type {'shutting-down'|'terminated'} */ (instanceState),
          ),
        inspectRootVolume: async () => absentRootVolume(),
      });
      const journal = makeJournal({
        phase: 'destroyed',
        resources: presentResources().map((resource) => ({
          ...resource,
          state: 'absent',
        })),
      });

      await expect(
        createAwsSingleNodeStatusFactory(dependencies)({ journal }),
      ).resolves.toEqual({
        status: 'exact',
        resources: [
          {
            role: 'instance',
            id: IDS.instance,
            state: 'absent',
            publicIpv4: null,
          },
          {
            role: 'root-volume',
            id: IDS.rootVolume,
            state: 'absent',
            publicIpv4: null,
          },
          {
            role: 'security-group',
            id: IDS.securityGroup,
            state: 'absent',
            publicIpv4: null,
          },
        ],
      });
      expect(spies.inspectInstance).toHaveBeenCalledTimes(1);
      expect(spies.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['provisioned', 'activating'])(
    'reports exact provider evidence while the %s journal still converges',
    async (phase) => {
      const { dependencies } = makePorts();

      await expect(
        createAwsSingleNodeStatusFactory(dependencies)({
          journal: makeJournal({ phase }),
        }),
      ).resolves.toMatchObject({ status: 'exact' });
    },
  );

  it('reports a prepared partial deployment as converging without polling', async () => {
    const { dependencies, spies } = makePorts({
      inspectInstance: async () => absentInstance(),
    });
    const journal = makeJournal({
      phase: 'provisioning',
      resources: [presentResources()[0]],
      mutationAttempts: [{ role: 'instance', state: 'prepared' }],
    });

    await expect(
      createAwsSingleNodeStatusFactory(dependencies)({ journal }),
    ).resolves.toEqual({
      status: 'converging',
      resources: [
        {
          role: 'instance',
          id: null,
          state: 'settling',
          publicIpv4: null,
        },
        {
          role: 'root-volume',
          id: null,
          state: 'absent',
          publicIpv4: null,
        },
        {
          role: 'security-group',
          id: IDS.securityGroup,
          state: 'exact',
          publicIpv4: null,
        },
      ],
    });
    expect(spies.inspectSecurityGroup).toHaveBeenCalledTimes(1);
    expect(spies.inspectInstance).toHaveBeenCalledTimes(1);
    expect(spies.inspectRootVolume).not.toHaveBeenCalled();
    expect(spies.close).toHaveBeenCalledTimes(1);
  });

  it('keeps exact effects ahead of prepared journal records exact', async () => {
    const { dependencies } = makePorts();
    const journal = makeJournal({
      phase: 'provisioning',
      resources: [],
      mutationAttempts: [
        { role: 'securityGroup', state: 'prepared' },
        { role: 'instance', state: 'prepared' },
        { role: 'rootVolume', state: 'prepared' },
      ],
    });

    await expect(
      createAwsSingleNodeStatusFactory(dependencies)({ journal }),
    ).resolves.toMatchObject({
      status: 'exact',
      resources: [
        expect.objectContaining({ role: 'instance', state: 'exact' }),
        expect.objectContaining({ role: 'root-volume', state: 'exact' }),
        expect.objectContaining({ role: 'security-group', state: 'exact' }),
      ],
    });
  });

  it('keeps trustworthy absence exact and provider settling converging', async () => {
    const absent = makePorts({
      inspectSecurityGroup: async () => absentSecurityGroup(),
      inspectInstance: async () => absentInstance(),
      inspectRootVolume: async () => absentRootVolume(),
    });
    await expect(
      createAwsSingleNodeStatusFactory(absent.dependencies)({
        journal: makeJournal({ phase: 'destroying' }),
      }),
    ).resolves.toMatchObject({
      status: 'exact',
      resources: [
        expect.objectContaining({ role: 'instance', state: 'absent' }),
        expect.objectContaining({ role: 'root-volume', state: 'absent' }),
        expect.objectContaining({ role: 'security-group', state: 'absent' }),
      ],
    });

    const settling = makePorts({
      inspectInstance: async () =>
        Object.freeze({
          status: 'settling',
          ownershipStatus: 'owned',
          specStatus: 'incomplete',
          instanceId: IDS.instance,
          instanceState: 'pending',
          rootVolumeId: IDS.rootVolume,
          publicIpv4: null,
        }),
    });
    await expect(
      createAwsSingleNodeStatusFactory(settling.dependencies)({
        journal: makeJournal(),
      }),
    ).resolves.toMatchObject({
      status: 'converging',
      resources: [
        expect.objectContaining({ role: 'instance', state: 'settling' }),
        expect.any(Object),
        expect.any(Object),
      ],
    });
  });

  it('degrades an owned provider ID that conflicts with the journal', async () => {
    const { dependencies } = makePorts({
      inspectSecurityGroup: async () =>
        exactSecurityGroup(OTHER_SECURITY_GROUP_ID),
    });

    await expect(
      createAwsSingleNodeStatusFactory(dependencies)({
        journal: makeJournal(),
      }),
    ).resolves.toMatchObject({
      status: 'degraded',
      resources: [
        expect.objectContaining({ role: 'instance', state: 'exact' }),
        expect.objectContaining({ role: 'root-volume', state: 'exact' }),
        expect.objectContaining({
          role: 'security-group',
          id: IDS.securityGroup,
          state: 'conflict',
        }),
      ],
    });
  });

  it('removes an untrusted address from conflicted instance evidence', async () => {
    const { dependencies } = makePorts({
      inspectInstance: async () =>
        Object.freeze({
          ...exactInstance(),
          publicIpv4: '203.0.113.41',
        }),
    });

    await expect(
      createAwsSingleNodeStatusFactory(dependencies)({
        journal: makeJournal(),
      }),
    ).resolves.toMatchObject({
      status: 'degraded',
      resources: [
        {
          role: 'instance',
          id: IDS.instance,
          state: 'conflict',
          publicIpv4: null,
        },
        expect.any(Object),
        expect.any(Object),
      ],
    });
  });

  it('closes authority on scope mismatch and redacts opening/read failures', async () => {
    const mismatch = makePorts({ resolvedScope: OTHER_SCOPE });
    await expect(
      createAwsSingleNodeStatusFactory(mismatch.dependencies)({
        journal: makeJournal(),
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodeStatusScopeError);
    expect(mismatch.spies.inspectSecurityGroup).not.toHaveBeenCalled();
    expect(mismatch.spies.close).toHaveBeenCalledTimes(1);

    const opening = makePorts({
      openError: new Error('ambient credential carried aws-secret-value'),
    });
    const openingFailure = await createAwsSingleNodeStatusFactory(
      opening.dependencies,
    )({ journal: makeJournal() }).catch(
      (/** @type {unknown} */ error) => error,
    );
    expect(openingFailure).toBeInstanceOf(AwsSingleNodeStatusReadError);
    expect(String(openingFailure)).not.toContain('aws-secret-value');

    const reading = makePorts({
      inspectSecurityGroup: async () => {
        throw new AwsSingleNodeEvidenceTransientError();
      },
    });
    await expect(
      createAwsSingleNodeStatusFactory(reading.dependencies)({
        journal: makeJournal(),
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodeStatusReadError);
    expect(reading.spies.close).toHaveBeenCalledTimes(1);
  });

  it('returns only safe errors when inspection and cleanup both fail', async () => {
    const { dependencies } = makePorts({
      inspectSecurityGroup: async () => {
        throw new Error('read carried aws-secret-value');
      },
      closeError: new Error('close carried aws-secret-value'),
    });

    const failure = await createAwsSingleNodeStatusFactory(dependencies)({
      journal: makeJournal(),
    }).catch((/** @type {unknown} */ error) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    const aggregate = /** @type {AggregateError} */ (failure);
    expect(aggregate.errors).toHaveLength(2);
    expect(
      aggregate.errors.every(
        (/** @type {unknown} */ error) =>
          error instanceof AwsSingleNodeStatusReadError,
      ),
    ).toBe(true);
    expect(String(failure)).not.toContain('aws-secret-value');
  });
});
