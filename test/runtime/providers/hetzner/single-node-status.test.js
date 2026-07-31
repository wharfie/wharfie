import { describe, expect, it, jest } from '@jest/globals';

import { sha256Base64Url } from '../../../../src/core/runtime/content-id.js';

const JOURNAL_IMPORT =
  '../../../../src/core/runtime/single-node-deployment-journal.js';
const STATUS_IMPORT =
  '../../../../src/core/runtime/providers/hetzner/single-node-status.js';

/** @type {jest.Mock<(value: unknown) => Readonly<Record<string, any>>>} */
const validateSingleNodeDeploymentJournal = jest.fn(
  (value) => /** @type {Readonly<Record<string, any>>} */ (value),
);

jest.unstable_mockModule(JOURNAL_IMPORT, () => ({
  validateSingleNodeDeploymentJournal,
}));

const {
  HetznerSingleNodeStatusCredentialError,
  HetznerSingleNodeStatusReadError,
  createHetznerSingleNodeStatusFactory,
} = await import(STATUS_IMPORT);

const TOKEN = 'hcloud-test-token';
const DATA_ROOT = '/tmp/wharfie-hetzner-status-test';
const DEPLOYMENT_INSTANCE_ID = `wsnd1_${sha256Base64Url(
  'hetzner-status-deployment',
)}`;
const BINDING_ID = `whcb1_${sha256Base64Url('hetzner-status-binding')}`;
const PUBLIC_IPV4 = '192.0.2.44';
const IDS = Object.freeze({ firewall: 10, primaryIp: 11, server: 12 });
const READ_METHODS = Object.freeze([
  'listFirewalls',
  'getFirewall',
  'listPrimaryIps',
  'getPrimaryIp',
  'listServers',
  'getServer',
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
      role: 'firewall',
      providerResourceId: IDS.firewall,
      state: 'present',
      publicIpv4: null,
    },
    {
      role: 'primaryIp',
      providerResourceId: IDS.primaryIp,
      state: 'present',
      publicIpv4: PUBLIC_IPV4,
    },
    {
      role: 'server',
      providerResourceId: IDS.server,
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
    deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
    providerIntent: Object.freeze({
      provider: 'hetzner',
      intent: Object.freeze({ provisioningIntentId: 'wshpi1_test-status' }),
    }),
    resources: Object.freeze(value.resources ?? presentResources()),
    mutationAttempts: Object.freeze(value.mutationAttempts ?? []),
  });
}

/**
 * @param {{firewall?: Record<string, any>, primaryIp?: Record<string, any>, server?: Record<string, any>}} [overrides]
 */
function exactObservation(overrides = {}) {
  return Object.freeze({
    firewall: Object.freeze({
      id: IDS.firewall,
      state: 'exact',
      publicIpv4: null,
      ...overrides.firewall,
    }),
    primaryIp: Object.freeze({
      id: IDS.primaryIp,
      state: 'exact',
      publicIpv4: PUBLIC_IPV4,
      ...overrides.primaryIp,
    }),
    server: Object.freeze({
      id: IDS.server,
      state: 'exact',
      publicIpv4: PUBLIC_IPV4,
      ...overrides.server,
    }),
  });
}

function absentObservation() {
  return Object.freeze({
    firewall: Object.freeze({
      id: null,
      state: 'absent',
      publicIpv4: null,
    }),
    primaryIp: Object.freeze({
      id: null,
      state: 'absent',
      publicIpv4: null,
    }),
    server: Object.freeze({
      id: null,
      state: 'absent',
      publicIpv4: null,
    }),
  });
}

/**
 * @param {{readToken?: Function, requireBinding?: Function, createReadClient?: Function, inspectResources?: Function}} [options]
 */
function makePorts(options = {}) {
  const order = /** @type {string[]} */ ([]);
  let mutationCapabilityRead = false;
  const api = Object.fromEntries(
    READ_METHODS.map((method) => [method, jest.fn(async () => ({ method }))]),
  );
  Object.defineProperty(api, 'createServer', {
    enumerable: true,
    get() {
      mutationCapabilityRead = true;
      throw new Error('mutation capability must remain unreachable');
    },
  });
  const readToken = jest.fn(async () => {
    if (options.readToken) {
      return await Reflect.apply(options.readToken, undefined, []);
    }
    order.push('token');
    return TOKEN;
  });
  const requireBinding = jest.fn(
    async (/** @type {unknown} */ bindingRequest) => {
      if (options.requireBinding) {
        return await Reflect.apply(options.requireBinding, undefined, [
          bindingRequest,
        ]);
      }
      order.push('binding');
      return Object.freeze({
        schemaVersion: 1,
        kind: 'hetznerCredentialBindingEvidence',
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        bindingId: BINDING_ID,
      });
    },
  );
  const createReadClient = jest.fn(
    async (/** @type {unknown} */ clientRequest) => {
      if (options.createReadClient) {
        return await Reflect.apply(options.createReadClient, undefined, [
          clientRequest,
        ]);
      }
      order.push('client');
      return api;
    },
  );
  const inspectResources = jest.fn(
    async (/** @type {unknown} */ inspection) => {
      if (options.inspectResources) {
        return await Reflect.apply(options.inspectResources, undefined, [
          inspection,
        ]);
      }
      order.push('inspect');
      return exactObservation();
    },
  );
  return {
    dependencies: {
      readToken,
      requireBinding,
      createReadClient,
      inspectResources,
    },
    spies: {
      order,
      readToken,
      requireBinding,
      createReadClient,
      inspectResources,
      mutationCapabilityWasRead: () => mutationCapabilityRead,
    },
  };
}

describe('Hetzner single-node deployment status', () => {
  it('requires durable credential binding before exact one-shot reads', async () => {
    const { dependencies, spies } = makePorts();
    const inspect = createHetznerSingleNodeStatusFactory(dependencies);
    const result = await inspect({
      journal: makeJournal(),
      dataRoot: DATA_ROOT,
    });

    expect(result).toEqual({
      status: 'exact',
      resources: [
        {
          role: 'firewall',
          id: String(IDS.firewall),
          state: 'exact',
          publicIpv4: null,
        },
        {
          role: 'primary-ip',
          id: String(IDS.primaryIp),
          state: 'exact',
          publicIpv4: PUBLIC_IPV4,
        },
        {
          role: 'server',
          id: String(IDS.server),
          state: 'exact',
          publicIpv4: PUBLIC_IPV4,
        },
      ],
    });
    expect(deeplyFrozen(result)).toBe(true);
    expect(spies.order).toEqual(['token', 'binding', 'client', 'inspect']);
    expect(spies.requireBinding).toHaveBeenCalledWith({
      dataRoot: DATA_ROOT,
      deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
      token: TOKEN,
    });
    expect(spies.createReadClient).toHaveBeenCalledWith({ token: TOKEN });
    const inspection = /** @type {Record<string, any>} */ (
      spies.inspectResources.mock.calls[0][0]
    );
    expect(inspection.storedResourceIds).toEqual(IDS);
    expect(Object.keys(inspection.api)).toEqual(READ_METHODS);
    expect(Object.isFrozen(inspection.api)).toBe(true);
    expect(spies.mutationCapabilityWasRead()).toBe(false);
  });

  it('reports exact destroyed state after provider-confirmed absence', async () => {
    const { dependencies } = makePorts({
      inspectResources: async () => absentObservation(),
    });
    const journal = makeJournal({
      phase: 'destroyed',
      resources: presentResources().map((resource) => ({
        ...resource,
        state: 'absent',
      })),
    });

    await expect(
      createHetznerSingleNodeStatusFactory(dependencies)({
        journal,
        dataRoot: DATA_ROOT,
      }),
    ).resolves.toEqual({
      status: 'exact',
      resources: [
        {
          role: 'firewall',
          id: String(IDS.firewall),
          state: 'absent',
          publicIpv4: null,
        },
        {
          role: 'primary-ip',
          id: String(IDS.primaryIp),
          state: 'absent',
          publicIpv4: null,
        },
        {
          role: 'server',
          id: String(IDS.server),
          state: 'absent',
          publicIpv4: null,
        },
      ],
    });
  });

  it.each(['provisioned', 'activating'])(
    'reports exact provider evidence while the %s journal still converges',
    async (phase) => {
      const { dependencies } = makePorts();

      await expect(
        createHetznerSingleNodeStatusFactory(dependencies)({
          journal: makeJournal({ phase }),
          dataRoot: DATA_ROOT,
        }),
      ).resolves.toMatchObject({ status: 'exact' });
    },
  );

  it('reports partial prepared state as converging without polling', async () => {
    const { dependencies, spies } = makePorts({
      inspectResources: async () =>
        exactObservation({
          primaryIp: { id: null, state: 'absent', publicIpv4: null },
          server: { id: null, state: 'absent', publicIpv4: null },
        }),
    });
    const journal = makeJournal({
      phase: 'provisioning',
      resources: [presentResources()[0]],
      mutationAttempts: [{ role: 'primaryIp', state: 'prepared' }],
    });

    await expect(
      createHetznerSingleNodeStatusFactory(dependencies)({
        journal,
        dataRoot: DATA_ROOT,
      }),
    ).resolves.toEqual({
      status: 'converging',
      resources: [
        {
          role: 'firewall',
          id: String(IDS.firewall),
          state: 'exact',
          publicIpv4: null,
        },
        {
          role: 'primary-ip',
          id: null,
          state: 'settling',
          publicIpv4: null,
        },
        {
          role: 'server',
          id: null,
          state: 'absent',
          publicIpv4: null,
        },
      ],
    });
    expect(spies.inspectResources).toHaveBeenCalledTimes(1);
  });

  it('keeps exact effects ahead of prepared journal records exact', async () => {
    const { dependencies } = makePorts();
    const journal = makeJournal({
      phase: 'provisioning',
      resources: [],
      mutationAttempts: [
        { role: 'firewall', state: 'prepared' },
        { role: 'primaryIp', state: 'prepared' },
        { role: 'server', state: 'prepared' },
      ],
    });

    await expect(
      createHetznerSingleNodeStatusFactory(dependencies)({
        journal,
        dataRoot: DATA_ROOT,
      }),
    ).resolves.toMatchObject({
      status: 'exact',
      resources: [
        expect.objectContaining({ role: 'firewall', state: 'exact' }),
        expect.objectContaining({ role: 'primary-ip', state: 'exact' }),
        expect.objectContaining({ role: 'server', state: 'exact' }),
      ],
    });
  });

  it('keeps trustworthy absence exact and provider settling converging', async () => {
    const absent = makePorts({
      inspectResources: async () => absentObservation(),
    });
    await expect(
      createHetznerSingleNodeStatusFactory(absent.dependencies)({
        journal: makeJournal({ phase: 'destroying' }),
        dataRoot: DATA_ROOT,
      }),
    ).resolves.toMatchObject({
      status: 'exact',
      resources: [
        expect.objectContaining({ role: 'firewall', state: 'absent' }),
        expect.objectContaining({ role: 'primary-ip', state: 'absent' }),
        expect.objectContaining({ role: 'server', state: 'absent' }),
      ],
    });

    const settling = makePorts({
      inspectResources: async () =>
        exactObservation({ server: { state: 'settling' } }),
    });
    await expect(
      createHetznerSingleNodeStatusFactory(settling.dependencies)({
        journal: makeJournal(),
        dataRoot: DATA_ROOT,
      }),
    ).resolves.toMatchObject({
      status: 'converging',
      resources: [
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({ role: 'server', state: 'settling' }),
      ],
    });
  });

  it('degrades provider ID and cross-resource address conflicts safely', async () => {
    const { dependencies } = makePorts({
      inspectResources: async () =>
        exactObservation({
          primaryIp: { id: 91 },
          server: { state: 'conflict', publicIpv4: '192.0.2.91' },
        }),
    });

    await expect(
      createHetznerSingleNodeStatusFactory(dependencies)({
        journal: makeJournal(),
        dataRoot: DATA_ROOT,
      }),
    ).resolves.toMatchObject({
      status: 'degraded',
      resources: [
        expect.objectContaining({ role: 'firewall', state: 'exact' }),
        expect.objectContaining({
          role: 'primary-ip',
          id: String(IDS.primaryIp),
          state: 'conflict',
          publicIpv4: null,
        }),
        expect.objectContaining({
          role: 'server',
          state: 'conflict',
          publicIpv4: null,
        }),
      ],
    });
  });

  it('blocks every provider capability when credential binding is unavailable', async () => {
    const missing = makePorts({
      requireBinding: async () => {
        throw new Error('binding failure carried hcloud-secret-value');
      },
    });
    const failure = await createHetznerSingleNodeStatusFactory(
      missing.dependencies,
    )({
      journal: makeJournal(),
      dataRoot: DATA_ROOT,
    }).catch((/** @type {unknown} */ error) => error);

    expect(failure).toBeInstanceOf(HetznerSingleNodeStatusCredentialError);
    expect(String(failure)).not.toContain('hcloud-secret-value');
    expect(missing.spies.createReadClient).not.toHaveBeenCalled();
    expect(missing.spies.inspectResources).not.toHaveBeenCalled();

    const tokenRead = makePorts({
      readToken: async () => {
        throw new Error('environment carried hcloud-secret-value');
      },
    });
    await expect(
      createHetznerSingleNodeStatusFactory(tokenRead.dependencies)({
        journal: makeJournal(),
        dataRoot: DATA_ROOT,
      }),
    ).rejects.toBeInstanceOf(HetznerSingleNodeStatusCredentialError);
    expect(tokenRead.spies.requireBinding).not.toHaveBeenCalled();
    expect(tokenRead.spies.createReadClient).not.toHaveBeenCalled();
  });

  it('redacts read failures and never reaches mutation capabilities', async () => {
    const reading = makePorts({
      inspectResources: async () => {
        throw new Error('read carried hcloud-secret-value');
      },
    });
    const failure = await createHetznerSingleNodeStatusFactory(
      reading.dependencies,
    )({
      journal: makeJournal(),
      dataRoot: DATA_ROOT,
    }).catch((/** @type {unknown} */ error) => error);

    expect(failure).toBeInstanceOf(HetznerSingleNodeStatusReadError);
    expect(String(failure)).not.toContain('hcloud-secret-value');
    expect(reading.spies.mutationCapabilityWasRead()).toBe(false);
    expect(reading.spies.inspectResources).toHaveBeenCalledTimes(1);
  });
});
