import { describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../../../src/core/runtime/content-id.js';
import {
  HETZNER_SMALL_SERVER_TYPE_CANDIDATES,
  resolveHetznerSingleNodePlan,
  validateHetznerSingleNodePlan,
} from '../../../../src/core/runtime/providers/hetzner/single-node-plan.js';
import { createSingleNodeDeploymentDesired } from '../../../../src/core/runtime/single-node-deployment-desired.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../../../../src/core/runtime/single-node-deployment-intent.js';

const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/** @param {string|Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

function makeDesired() {
  const revision = createApplicationRevision({
    contract: {
      schemaVersion: 4,
      app: { id: 'hello-app' },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'src/cli.js',
          export: 'main',
        },
      },
      activities: {
        greet: {
          entrypoint: {
            kind: 'node',
            path: 'src/greet.js',
            export: 'greet',
          },
        },
      },
    },
    inputs: {
      source: { format: 'wharfie-source-tree-v1', digest: digest('source') },
      dependencies: {
        format: 'wharfie-npm-package-lock-v3-closure-v1',
        digest: digest('dependencies'),
      },
      runtime: { format: 'wharfie-runtime-v1', digest: digest('runtime') },
    },
  });
  const bytes = Buffer.from('exact Linux SEA payload');
  const artifactRecord = createArtifactRecord({
    bytes,
    revision,
    target: TARGET,
    provenance: {
      schemaVersion: 1,
      builder: {
        name: '@wharfie/wharfie',
        version: '0.0.15',
        runtimeDigest: revision.inputs.runtime.digest,
        toolchainDigest: digest('toolchain'),
      },
      node: {
        version: TARGET.nodeVersion,
        archive: {
          fileName: `node-v${TARGET.nodeVersion}-linux-x64.tar.gz`,
          digest: digest('node-archive'),
        },
        binary: { digest: digest('node-binary') },
      },
      dependencies: {
        lock: revision.inputs.dependencies,
        digest: digest('dependency-closure'),
      },
      signing: { mode: 'unsigned' },
    },
  });
  const intent = createSingleNodeDeploymentIntent({
    deployment: { id: 'hello-production' },
    appId: 'hello-app',
    target: TARGET,
    mode: SINGLE_NODE_DEPLOYMENT_MODE,
    machine: SINGLE_NODE_MACHINE,
    access: {
      kind: 'public-ssh',
      allowedIpv4: ['203.0.113.7/32'],
    },
    provider: { kind: 'hetzner', location: 'fsn1' },
  });
  return createSingleNodeDeploymentDesired({
    intent,
    revision,
    artifactRecord,
    observation: {
      artifactId: artifactRecord.artifactId,
      byteDigest: artifactRecord.byteDigest,
      size: artifactRecord.size,
    },
  });
}

function location() {
  return {
    id: 1,
    name: 'fsn1',
    city: 'Falkenstein',
    country: 'DE',
    networkZone: 'eu-central',
  };
}

/** @param {string} name @param {boolean} [available] */
function serverType(name, available = true) {
  return {
    id: { cx23: 114, cpx12: 108, cpx22: 109 }[name],
    name,
    architecture: 'x86',
    cores: 2,
    memory: 4,
    disk: 40,
    locations: [
      {
        id: 1,
        name: 'fsn1',
        available,
        recommended: name === 'cx23',
        deprecation: null,
      },
    ],
  };
}

function image() {
  return {
    id: 300_001,
    name: 'ubuntu-24.04',
    description: 'Ubuntu 24.04',
    type: 'system',
    status: 'available',
    architecture: 'x86',
    osFlavor: 'ubuntu',
    osVersion: '24.04',
    rapidDeploy: true,
    deprecatedAt: null,
  };
}

/**
 * @param {Record<string, any>} [overrides] - Method overrides.
 * @returns {Record<string, any>} - Read and mutation spies.
 */
function makeApi(overrides = {}) {
  const methods = /** @type {Record<string, any>} */ ({
    listLocations: jest.fn(async () => [location()]),
    listServerTypes: jest.fn(async () =>
      HETZNER_SMALL_SERVER_TYPE_CANDIDATES.map((name) => serverType(name)),
    ),
    listImages: jest.fn(async () => [image()]),
    listFirewalls: jest.fn(async () => []),
    listPrimaryIps: jest.fn(async () => []),
    listServers: jest.fn(async () => []),
    createFirewall: jest.fn(async () => {
      throw new Error('mutation must remain unreachable');
    }),
    createPrimaryIp: jest.fn(async () => {
      throw new Error('mutation must remain unreachable');
    }),
    createServer: jest.fn(async () => {
      throw new Error('mutation must remain unreachable');
    }),
    ...overrides,
  });
  return methods;
}

describe('Hetzner single-node read-only plan', () => {
  it('resolves one deterministic actionable aggregate without mutation', async () => {
    const desired = makeDesired();
    const api = makeApi();
    const first = await resolveHetznerSingleNodePlan({ desired, api });
    const second = await resolveHetznerSingleNodePlan({ desired, api });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      kind: 'hetznerSingleNodeDeploymentPlan',
      planId: expect.stringMatching(/^wsnp1_[A-Za-z0-9_-]{43}$/u),
      deploymentInstanceId: desired.deploymentInstanceId,
      desired,
      providerSpec: {
        providerSpecId: expect.stringMatching(/^wshp1_[A-Za-z0-9_-]{43}$/u),
        location: { id: 1, name: 'fsn1' },
        serverType: { id: 114, name: 'cx23' },
        image: { id: 300_001, name: 'ubuntu-24.04' },
        ownedResourceCount: 3,
      },
      inspection: {
        status: 'absent',
        observedOwnedResourceCount: 0,
      },
      status: 'actionable',
      blockedReason: null,
    });
    expect(first.actions.map((action) => action.kind)).toEqual([
      'provision-managed-node',
      'activate-application',
    ]);
    expect(first.actions[0].dependsOn).toEqual([]);
    expect(first.actions[1].dependsOn).toEqual([first.actions[0].actionId]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.desired)).toBe(true);
    expect(api.createFirewall).not.toHaveBeenCalled();
    expect(api.createPrimaryIp).not.toHaveBeenCalled();
    expect(api.createServer).not.toHaveBeenCalled();
  });

  it('uses exact read filters and falls back through code-owned small types', async () => {
    const desired = makeDesired();
    const api = makeApi({
      listServerTypes: jest.fn(async () => [
        serverType('cx23', false),
        serverType('cpx12', true),
      ]),
    });

    const plan = await resolveHetznerSingleNodePlan({ desired, api });

    expect(plan.providerSpec.serverType).toEqual({
      id: 108,
      name: 'cpx12',
    });
    expect(api.listLocations).toHaveBeenCalledWith({ name: 'fsn1' });
    expect(api.listServerTypes).toHaveBeenCalledWith({ architecture: 'x86' });
    expect(api.listImages).toHaveBeenCalledWith({
      name: 'ubuntu-24.04',
      type: 'system',
      architecture: 'x86',
      includeDeprecated: false,
    });
    const query = api.listServers.mock.calls[0][0];
    expect(query.labelSelector).toMatch(
      /^wharfie\.dev\/deployment=wsnd1-[a-z2-7]{52}$/u,
    );
    expect(api.listFirewalls).toHaveBeenCalledWith(query);
    expect(api.listPrimaryIps).toHaveBeenCalledWith(query);
  });

  it('reports provider residue as a blocked aggregate without disclosing it', async () => {
    const sentinel = 'operator-provider-field-must-not-leak';
    const api = makeApi({
      listServers: jest.fn(async () => [
        {
          id: 9,
          labels: {},
          operatorNote: sentinel,
        },
      ]),
    });

    const plan = await resolveHetznerSingleNodePlan({
      desired: makeDesired(),
      api,
    });

    expect(plan.status).toBe('blocked');
    expect(plan.blockedReason).toBe('unbound-provider-resources');
    expect(plan.inspection).toEqual({
      status: 'unbound-conflict',
      observedOwnedResourceCount: 1,
    });
    expect(plan.actions).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain(sentinel);
  });

  it.each([
    [
      'location',
      { listLocations: jest.fn(async () => []) },
      /exactly one location/iu,
    ],
    [
      'server type',
      { listServerTypes: jest.fn(async () => []) },
      /no supported small x86/iu,
    ],
    [
      'image',
      {
        listImages: jest.fn(async () => [
          { ...image(), deprecatedAt: '2026-01-01T00:00:00Z' },
        ]),
      },
      /exactly one current image/iu,
    ],
  ])(
    'fails closed on an invalid %s selection',
    async (_name, override, error) => {
      await expect(
        resolveHetznerSingleNodePlan({
          desired: makeDesired(),
          api: makeApi(override),
        }),
      ).rejects.toThrow(error);
    },
  );

  it('validates serialized plans and rejects changed provider selection', async () => {
    const plan = await resolveHetznerSingleNodePlan({
      desired: makeDesired(),
      api: makeApi(),
    });
    const serialized = clone(plan);

    expect(validateHetznerSingleNodePlan(serialized)).toEqual(plan);
    serialized.providerSpec.serverType.name = 'changed';
    expect(() => validateHetznerSingleNodePlan(serialized)).toThrow(
      /providerSpecId does not match/iu,
    );
  });

  it('rejects credential fields without echoing their values', async () => {
    const sentinel = 'secret-hcloud-token-sentinel';
    let thrown;
    try {
      await resolveHetznerSingleNodePlan({
        desired: makeDesired(),
        api: makeApi(),
        token: sentinel,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).not.toContain(sentinel);
  });
});
