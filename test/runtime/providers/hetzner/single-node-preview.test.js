import { describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../../../src/core/runtime/content-id.js';
import { createHetznerPreviewApiClient } from '../../../../src/core/runtime/providers/hetzner/api-client.js';
import {
  createHetznerSingleNodePreview,
  createHetznerSingleNodePreviewFactory,
} from '../../../../src/core/runtime/providers/hetzner/single-node-preview.js';
import {
  HETZNER_SMALL_SERVER_TYPE_CANDIDATES,
  resolveHetznerSingleNodePlan,
} from '../../../../src/core/runtime/providers/hetzner/single-node-plan.js';
import { createSingleNodeDeploymentDesired } from '../../../../src/core/runtime/single-node-deployment-desired.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../../../../src/core/runtime/single-node-deployment-intent.js';

const TOKEN = 'hcloud-preview-token-sentinel';
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const PLAN_READ_METHODS = Object.freeze([
  'listLocations',
  'listServerTypes',
  'listImages',
  'listFirewalls',
  'listPrimaryIps',
  'listServers',
]);

/** @param {string|Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {'hetzner'|'aws'} [provider] */
function makeDesired(provider = 'hetzner') {
  const revision = createApplicationRevision({
    contract: {
      schemaVersion: 4,
      app: { id: 'hello-app' },
      cli: {
        entrypoint: { kind: 'node', path: 'src/cli.js', export: 'main' },
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
    provider:
      provider === 'hetzner'
        ? { kind: 'hetzner', location: 'fsn1' }
        : { kind: 'aws', region: 'us-east-2' },
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

/** @param {string} name */
function serverType(name) {
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
        available: true,
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
 * @param {string} key
 * @param {Readonly<Record<string, any>[]>} values
 * @returns {Response}
 */
function listResponse(key, values) {
  return new Response(
    JSON.stringify({
      [key]: values,
      meta: {
        pagination: {
          page: 1,
          per_page: 25,
          previous_page: null,
          next_page: null,
          last_page: 1,
          total_entries: values.length,
        },
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

/**
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function makeApi(overrides = {}) {
  return {
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
  };
}

describe('Hetzner single-node provider preview', () => {
  it('constructs an exact frozen client containing only planner GET methods', () => {
    const client = createHetznerPreviewApiClient({ token: TOKEN });

    expect(Object.keys(client).sort()).toEqual([...PLAN_READ_METHODS].sort());
    expect(client.createFirewall).toBeUndefined();
    expect(client.createPrimaryIp).toBeUndefined();
    expect(client.createServer).toBeUndefined();
    expect(client.deleteFirewall).toBeUndefined();
    expect(client.deletePrimaryIp).toBeUndefined();
    expect(client.deleteServer).toBeUndefined();
    expect(Object.isFrozen(client)).toBe(true);
    expect(JSON.stringify(client)).not.toContain(TOKEN);
  });

  it('reads HCLOUD_TOKEN only at the production edge and issues only GETs', async () => {
    const desired = makeDesired();
    const originalToken = process.env.HCLOUD_TOKEN;
    process.env.HCLOUD_TOKEN = TOKEN;
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname.endsWith('/locations')) {
          return listResponse('locations', [
            {
              id: 1,
              name: 'fsn1',
              city: 'Falkenstein',
              country: 'DE',
              network_zone: 'eu-central',
            },
          ]);
        }
        if (pathname.endsWith('/server_types')) {
          return listResponse(
            'server_types',
            HETZNER_SMALL_SERVER_TYPE_CANDIDATES.map((name) => ({
              id: { cx23: 114, cpx12: 108, cpx22: 109 }[name],
              name,
              architecture: 'x86',
              cores: 2,
              memory: 4,
              disk: 40,
              deprecated: false,
              deprecation: null,
              locations: [
                {
                  id: 1,
                  name: 'fsn1',
                  available: true,
                  recommended: name === 'cx23',
                  deprecation: null,
                },
              ],
            })),
          );
        }
        if (pathname.endsWith('/images')) {
          return listResponse('images', [
            {
              id: 300_001,
              name: 'ubuntu-24.04',
              description: 'Ubuntu 24.04',
              type: 'system',
              status: 'available',
              architecture: 'x86',
              os_flavor: 'ubuntu',
              os_version: '24.04',
              rapid_deploy: true,
              deprecated: null,
            },
          ]);
        }
        if (pathname.endsWith('/firewalls')) {
          return listResponse('firewalls', []);
        }
        if (pathname.endsWith('/primary_ips')) {
          return listResponse('primary_ips', []);
        }
        if (pathname.endsWith('/servers')) {
          return listResponse('servers', []);
        }
        throw new Error('unexpected Hetzner preview endpoint');
      });
    try {
      await expect(
        createHetznerSingleNodePreview({ desired }),
      ).resolves.toMatchObject({
        kind: 'hetznerSingleNodeDeploymentPlan',
        status: 'actionable',
        desired,
      });
      expect(fetchSpy).toHaveBeenCalledTimes(6);
      for (const [, request] of fetchSpy.mock.calls) {
        expect(request).toMatchObject({
          method: 'GET',
          headers: { authorization: `Bearer ${TOKEN}` },
        });
        expect(request).not.toHaveProperty('body');
      }
    } finally {
      fetchSpy.mockRestore();
      if (originalToken === undefined) {
        delete process.env.HCLOUD_TOKEN;
      } else {
        process.env.HCLOUD_TOKEN = originalToken;
      }
    }
  });

  it('returns a canonical plan without exposing injected mutation siblings', async () => {
    const desired = makeDesired();
    const expected = await resolveHetznerSingleNodePlan({
      desired,
      api: makeApi(),
    });
    const client = makeApi();
    Object.defineProperty(client, 'deleteEverything', {
      enumerable: true,
      get() {
        throw new Error('mutation getter must remain unreachable');
      },
    });
    const createReadClient = jest.fn(
      /** @param {Record<string, any>} _value */
      async (_value) => client,
    );
    const readToken = jest.fn(async () => TOKEN);
    const resolvePlan = jest.fn(
      /** @param {Record<string, any>} value */
      async (value) => {
        expect(Object.keys(value.api).sort()).toEqual(
          [...PLAN_READ_METHODS].sort(),
        );
        expect(value.api.createFirewall).toBeUndefined();
        expect(value.api.createPrimaryIp).toBeUndefined();
        expect(value.api.createServer).toBeUndefined();
        return expected;
      },
    );
    const preview = createHetznerSingleNodePreviewFactory({
      createReadClient,
      resolvePlan,
      readToken,
    });

    await expect(preview({ desired })).resolves.toEqual(expected);

    expect(readToken).toHaveBeenCalledTimes(1);
    expect(createReadClient).toHaveBeenCalledWith({ token: TOKEN });
    expect(resolvePlan).toHaveBeenCalledTimes(1);
    expect(client.createFirewall).not.toHaveBeenCalled();
    expect(client.createPrimaryIp).not.toHaveBeenCalled();
    expect(client.createServer).not.toHaveBeenCalled();
    expect(JSON.stringify(expected)).not.toContain(TOKEN);
  });

  it('validates the returned canonical plan', async () => {
    const desired = makeDesired();
    const plan = await resolveHetznerSingleNodePlan({
      desired,
      api: makeApi(),
    });
    const changed = JSON.parse(JSON.stringify(plan));
    changed.providerSpec.serverType.name = 'changed-after-resolution';
    const preview = createHetznerSingleNodePreviewFactory({
      createReadClient: jest.fn(async () => makeApi()),
      resolvePlan: jest.fn(async () => changed),
      readToken: jest.fn(async () => TOKEN),
    });

    await expect(preview({ desired })).rejects.toThrow(
      /providerSpecId does not match/iu,
    );
  });

  it('rejects missing ambient token authority before constructing a client', async () => {
    const createReadClient = jest.fn();
    const preview = createHetznerSingleNodePreviewFactory({
      createReadClient,
      resolvePlan: jest.fn(),
      readToken: jest.fn(async () => undefined),
    });

    await expect(preview({ desired: makeDesired() })).rejects.toThrow(
      /requires ambient HCLOUD_TOKEN authority/iu,
    );
    expect(createReadClient).not.toHaveBeenCalled();
  });

  it('rejects a non-Hetzner desired state before reading credentials', async () => {
    const readToken = jest.fn();
    const preview = createHetznerSingleNodePreviewFactory({
      createReadClient: jest.fn(),
      resolvePlan: jest.fn(),
      readToken,
    });

    await expect(preview({ desired: makeDesired('aws') })).rejects.toThrow(
      /must target Hetzner/iu,
    );
    expect(readToken).not.toHaveBeenCalled();
  });
});
