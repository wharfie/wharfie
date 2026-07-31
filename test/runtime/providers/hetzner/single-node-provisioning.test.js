import { describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../../../src/core/runtime/content-id.js';
import {
  HETZNER_PROVISIONING_MAX_SETTLE_ATTEMPTS,
  HETZNER_PROVISIONING_SETTLE_RETRY_DELAY_MILLISECONDS,
  convergeHetznerSingleNodeProvisioning,
  createHetznerProvisionedResourceRecord,
  createHetznerProvisioningMutationAttempt,
  createHetznerSingleNodeProvisioningIntent,
  inspectHetznerSingleNodeProvisioning,
  reconcileHetznerPreparedCreateForDestroy,
  validateHetznerProvisionedResourceRecord,
  validateHetznerProvisioningMutationAttempt,
  validateHetznerSingleNodeProvisioningIntent,
} from '../../../../src/core/runtime/providers/hetzner/single-node-provisioning.js';
import {
  HETZNER_SMALL_SERVER_TYPE_CANDIDATES,
  resolveHetznerSingleNodePlan,
} from '../../../../src/core/runtime/providers/hetzner/single-node-plan.js';
import { createSingleNodeDeploymentDesired } from '../../../../src/core/runtime/single-node-deployment-desired.js';
import { createSingleNodeDeploymentIncarnationId } from '../../../../src/core/runtime/single-node-deployment-identity.js';
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
const LOCATION = Object.freeze({
  id: 1,
  name: 'fsn1',
  city: 'Falkenstein',
  country: 'DE',
  networkZone: 'eu-central',
});
const IMAGE = Object.freeze({
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
});

/** @param {string|Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
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
        id: LOCATION.id,
        name: LOCATION.name,
        available: true,
        recommended: name === 'cx23',
        deprecation: null,
      },
    ],
  };
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
  const deploymentIntent = createSingleNodeDeploymentIntent({
    deployment: { id: 'hello-production' },
    appId: 'hello-app',
    target: TARGET,
    mode: SINGLE_NODE_DEPLOYMENT_MODE,
    machine: SINGLE_NODE_MACHINE,
    access: {
      kind: 'public-ssh',
      allowedIpv4: ['203.0.113.7/32'],
    },
    provider: { kind: 'hetzner', location: LOCATION.name },
  });
  return createSingleNodeDeploymentDesired({
    intent: deploymentIntent,
    revision,
    artifactRecord,
    observation: {
      artifactId: artifactRecord.artifactId,
      byteDigest: artifactRecord.byteDigest,
      size: artifactRecord.size,
    },
  });
}

async function makePlan() {
  return resolveHetznerSingleNodePlan({
    desired: makeDesired(),
    api: {
      listLocations: async () => [LOCATION],
      listServerTypes: async () =>
        HETZNER_SMALL_SERVER_TYPE_CANDIDATES.map(serverType),
      listImages: async () => [IMAGE],
      listFirewalls: async () => [],
      listPrimaryIps: async () => [],
      listServers: async () => [],
    },
  });
}

/** @param {Buffer} [cloudInit] */
async function makeFixture(
  cloudInit = Buffer.from(
    '#cloud-config\nwrite_files:\n  - path: /tmp/wharfie-secret-test\n',
  ),
) {
  const cloudInitBytes = Buffer.from(cloudInit);
  const intent = createHetznerSingleNodeProvisioningIntent({
    plan: await makePlan(),
    incarnationId: createSingleNodeDeploymentIncarnationId(
      Buffer.alloc(32, 19),
    ),
    ownershipNonces: {
      firewall: sha256Base64Url('firewall-nonce'),
      primaryIp: sha256Base64Url('primary-ip-nonce'),
      server: sha256Base64Url('server-nonce'),
    },
    cloudInitDigest: digest(cloudInitBytes),
  });
  return { intent, cloudInitBytes };
}

/**
 * @param {Awaited<ReturnType<typeof makeFixture>>} fixture
 * @param {{lostResponseRole?: string, rejectedCreateRole?: string, waitFailure?: boolean, recordFailure?: boolean, attemptRecordFailure?: boolean, rejectionRecordFailure?: boolean, readbackFailureRole?: string, transitionalServer?: boolean, settleDuringWait?: boolean}} [options]
 */
function makeProvider(fixture, options = {}) {
  const state = {
    firewalls: /** @type {any[]} */ ([]),
    primaryIps: /** @type {any[]} */ ([]),
    servers: /** @type {any[]} */ ([]),
    creationOrder: /** @type {string[]} */ ([]),
    events: /** @type {string[]} */ ([]),
    attempts: /** @type {any[]} */ ([]),
    rejections: /** @type {any[]} */ ([]),
    records: /** @type {any[]} */ ([]),
    actionIds: /** @type {number[]} */ ([]),
  };
  let nextId = 10;
  let nextActionId = 100;
  let recordFailed = false;
  let createRejected = false;

  /** @param {any[]} values @param {any} query */
  function list(values, query) {
    return values.filter(
      (value) =>
        (query.name === undefined || value.name === query.name) &&
        (query.labelSelector === undefined ||
          query.labelSelector.split(',').every((/** @type {string} */ part) => {
            const splitAt = part.indexOf('=');
            return (
              value.labels[part.slice(0, splitAt)] === part.slice(splitAt + 1)
            );
          })),
    );
  }

  /** @param {any[]} values @param {number} id */
  function get(values, id) {
    const result = values.find((value) => value.id === id);
    if (result === undefined) {
      const error = /** @type {Error & {status?: number}} */ (
        new Error('not found')
      );
      error.status = 404;
      throw error;
    }
    return result;
  }

  /** @param {string} role */
  function maybeLose(role) {
    if (options.lostResponseRole === role) {
      throw new Error('provider response carried hcloud-token-secret');
    }
  }

  /** @param {string} role */
  function maybeReject(role) {
    if (options.rejectedCreateRole === role && !createRejected) {
      createRejected = true;
      throw Object.assign(new Error('provider rejected hcloud-token-secret'), {
        code: 'HETZNER_API_REQUEST_FAILED',
        status: 422,
      });
    }
  }

  const api = {
    listFirewalls: jest.fn(async (/** @type {any} */ query) =>
      list(state.firewalls, query),
    ),
    getFirewall: jest.fn(async (/** @type {number} */ id) =>
      options.readbackFailureRole === 'firewall'
        ? Promise.reject(new Error('readback carried hcloud-token-secret'))
        : get(state.firewalls, id),
    ),
    createFirewall: jest.fn(async (/** @type {any} */ body) => {
      state.creationOrder.push('firewall');
      state.events.push('create:firewall');
      maybeReject('firewall');
      const firewall = {
        id: nextId++,
        name: body.name,
        labels: body.labels,
        rules: body.rules.map((/** @type {any} */ rule) => ({
          direction: rule.direction,
          sourceIps: rule.source_ips,
          destinationIps: [],
          protocol: rule.protocol,
          port: rule.port,
          description: null,
        })),
        appliedTo: [],
      };
      state.firewalls.push(firewall);
      const response = {
        firewall,
        actions: [{ id: nextActionId++ }],
      };
      maybeLose('firewall');
      return response;
    }),
    listPrimaryIps: jest.fn(async (/** @type {any} */ query) =>
      list(state.primaryIps, query),
    ),
    getPrimaryIp: jest.fn(async (/** @type {number} */ id) =>
      options.readbackFailureRole === 'primaryIp'
        ? Promise.reject(new Error('readback carried hcloud-token-secret'))
        : get(state.primaryIps, id),
    ),
    createPrimaryIp: jest.fn(async (/** @type {any} */ body) => {
      state.creationOrder.push('primaryIp');
      state.events.push('create:primaryIp');
      maybeReject('primaryIp');
      const primaryIp = {
        id: nextId++,
        name: body.name,
        ip: '192.0.2.44',
        type: 'ipv4',
        assigneeId: null,
        assigneeType: 'unassigned',
        autoDelete: body.auto_delete,
        blocked: false,
        location: LOCATION,
        labels: body.labels,
        deleteProtected: false,
      };
      state.primaryIps.push(primaryIp);
      const response = {
        primaryIp,
        action: { id: nextActionId++ },
      };
      maybeLose('primaryIp');
      return response;
    }),
    listServers: jest.fn(async (/** @type {any} */ query) =>
      list(state.servers, query),
    ),
    getServer: jest.fn(async (/** @type {number} */ id) =>
      options.readbackFailureRole === 'server'
        ? Promise.reject(new Error('readback carried hcloud-token-secret'))
        : get(state.servers, id),
    ),
    createServer: jest.fn(async (/** @type {any} */ body) => {
      state.creationOrder.push('server');
      state.events.push('create:server');
      maybeReject('server');
      const primaryIp = get(state.primaryIps, body.public_net.ipv4);
      const firewall = get(state.firewalls, body.firewalls[0].firewall);
      const server = {
        id: nextId++,
        name: body.name,
        status: options.transitionalServer ? 'initializing' : 'running',
        location: LOCATION,
        publicIpv4: {
          id: primaryIp.id,
          ip: primaryIp.ip,
          blocked: false,
        },
        publicIpv6: null,
        firewalls: [
          {
            id: firewall.id,
            status: options.transitionalServer ? 'pending' : 'applied',
          },
        ],
        serverType: { id: 114, name: 'cx23' },
        image: { id: IMAGE.id, name: IMAGE.name },
        labels: body.labels,
        locked: false,
        deleteProtected: false,
      };
      if (!options.transitionalServer) {
        primaryIp.assigneeId = server.id;
        primaryIp.assigneeType = 'server';
        firewall.appliedTo = [
          {
            type: 'server',
            serverId: server.id,
            labelSelector: null,
            appliedToResources: [],
          },
        ];
      }
      state.servers.push(server);
      const response = {
        server,
        action: { id: nextActionId++ },
        nextActions: [],
      };
      maybeLose('server');
      return response;
    }),
  };
  const waitForAction = jest.fn(async (/** @type {number} */ actionId) => {
    state.actionIds.push(actionId);
    state.events.push(`wait:${actionId}`);
    if (options.waitFailure) {
      throw new Error('action error includes hcloud-token-secret');
    }
  });
  const recordMutationAttempt = jest.fn(async (/** @type {any} */ record) => {
    state.attempts.push(record);
    state.events.push(`attempt:${record.role}`);
    if (options.attemptRecordFailure) {
      throw new Error('attempt storage carried hcloud-token-secret');
    }
  });
  const recordMutationRejection = jest.fn(async (/** @type {any} */ record) => {
    state.rejections.push(record);
    state.events.push(`rejection:${record.role}`);
    if (options.rejectionRecordFailure) {
      throw new Error('rejection storage carried hcloud-token-secret');
    }
  });
  const recordResource = jest.fn(async (/** @type {any} */ record) => {
    if (options.recordFailure && !recordFailed) {
      recordFailed = true;
      throw new Error('storage error includes hcloud-token-secret');
    }
    state.records.push(record);
    state.events.push(`resource:${record.role}`);
  });
  let settleWaits = 0;
  const wait = jest.fn(async (/** @type {number} */ milliseconds) => {
    state.events.push(`settle:${milliseconds}`);
    settleWaits += 1;
    if (options.settleDuringWait !== true) return;
    const server = state.servers[0];
    const firewall = state.firewalls[0];
    const primaryIp = state.primaryIps[0];
    if (settleWaits === 1) {
      server.status = 'running';
      server.firewalls = [{ id: firewall.id, status: 'applied' }];
    } else if (settleWaits === 2) {
      firewall.appliedTo = [
        {
          type: 'server',
          serverId: server.id,
          labelSelector: null,
          appliedToResources: [],
        },
      ];
    } else if (settleWaits === 3) {
      primaryIp.assigneeId = server.id;
      primaryIp.assigneeType = 'server';
    }
  });
  return {
    api,
    state,
    waitForAction,
    recordMutationAttempt,
    recordMutationRejection,
    recordResource,
    wait,
  };
}

/** @param {any[]} records */
function attemptsByRole(records) {
  /** @type {Record<string, any|null>} */
  const attempts = { firewall: null, primaryIp: null, server: null };
  for (const record of records) attempts[record.role] = record;
  return attempts;
}

describe('Hetzner single-node provisioning convergence', () => {
  it('reconciles a prepared create to an exact owned resource without posting', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture);
    const attempt = createHetznerProvisioningMutationAttempt(
      fixture.intent,
      'firewall',
    );
    provider.state.firewalls.push({
      id: 71,
      name: fixture.intent.resources.firewall.ownership.name,
      labels: fixture.intent.resources.firewall.ownership.labels,
    });

    const recovered = await reconcileHetznerPreparedCreateForDestroy({
      intent: fixture.intent,
      mutationAttempt: attempt,
      api: provider.api,
    });

    expect(recovered).toEqual(
      createHetznerProvisionedResourceRecord(fixture.intent, 'firewall', 71),
    );
    expect(provider.api.listFirewalls).toHaveBeenCalledTimes(2);
    expect(provider.api.createFirewall).not.toHaveBeenCalled();
    expect(provider.api.createPrimaryIp).not.toHaveBeenCalled();
    expect(provider.api.createServer).not.toHaveBeenCalled();
  });

  it('keeps clean prepared-create inventory retryable without posting', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture);
    const attempt = createHetznerProvisioningMutationAttempt(
      fixture.intent,
      'primaryIp',
    );

    await expect(
      reconcileHetznerPreparedCreateForDestroy({
        intent: fixture.intent,
        mutationAttempt: attempt,
        api: provider.api,
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_PROVISIONING_DESTROY_RECOVERY_PENDING',
      role: 'primaryIp',
    });
    expect(provider.api.listPrimaryIps).toHaveBeenCalledTimes(2);
    expect(provider.api.createFirewall).not.toHaveBeenCalled();
    expect(provider.api.createPrimaryIp).not.toHaveBeenCalled();
    expect(provider.api.createServer).not.toHaveBeenCalled();
  });

  it('creates exact resources in dependency order and returns secret-free evidence', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture);

    const result = await convergeHetznerSingleNodeProvisioning({
      ...fixture,
      api: provider.api,
      waitForAction: provider.waitForAction,
      recordMutationAttempt: provider.recordMutationAttempt,
      recordResource: provider.recordResource,
    });

    expect(provider.state.creationOrder).toEqual([
      'firewall',
      'primaryIp',
      'server',
    ]);
    expect(provider.api.createFirewall).toHaveBeenCalledTimes(1);
    expect(provider.api.createFirewall).toHaveBeenCalledWith({
      name: fixture.intent.resources.firewall.ownership.name,
      labels: fixture.intent.resources.firewall.ownership.labels,
      rules: [
        {
          direction: 'in',
          protocol: 'tcp',
          port: '22',
          source_ips: ['203.0.113.7/32'],
        },
      ],
    });
    expect(provider.api.createPrimaryIp).toHaveBeenCalledWith({
      name: fixture.intent.resources.primaryIp.ownership.name,
      type: 'ipv4',
      location: 'fsn1',
      auto_delete: false,
      labels: fixture.intent.resources.primaryIp.ownership.labels,
    });
    const serverBody = provider.api.createServer.mock.calls[0][0];
    expect(serverBody).toEqual({
      name: fixture.intent.resources.server.ownership.name,
      labels: fixture.intent.resources.server.ownership.labels,
      server_type: '114',
      image: String(IMAGE.id),
      location: 'fsn1',
      firewalls: [{ firewall: 10 }],
      public_net: {
        enable_ipv4: true,
        enable_ipv6: false,
        ipv4: 11,
      },
      start_after_create: true,
      user_data: fixture.cloudInitBytes.toString('utf8'),
    });
    expect(serverBody).not.toHaveProperty('ssh_keys');
    expect(provider.state.actionIds).toEqual([100, 101, 102]);
    expect(provider.state.events).toEqual([
      'attempt:firewall',
      'create:firewall',
      'resource:firewall',
      'wait:100',
      'attempt:primaryIp',
      'create:primaryIp',
      'resource:primaryIp',
      'wait:101',
      'attempt:server',
      'create:server',
      'resource:server',
      'wait:102',
    ]);
    expect(provider.state.attempts.map((record) => record.role)).toEqual([
      'firewall',
      'primaryIp',
      'server',
    ]);
    for (const record of provider.state.attempts) {
      expect(
        validateHetznerProvisioningMutationAttempt(
          record,
          fixture.intent,
          record.role,
        ),
      ).toEqual(record);
    }
    expect(provider.state.records.map((record) => record.role)).toEqual([
      'firewall',
      'primaryIp',
      'server',
    ]);
    for (const record of provider.state.records) {
      expect(
        validateHetznerProvisionedResourceRecord(
          record,
          fixture.intent,
          record.role,
        ),
      ).toEqual(record);
    }
    expect(result).toMatchObject({
      provisioningIntentId: fixture.intent.provisioningIntentId,
      incarnationId: fixture.intent.incarnationId,
      resources: { firewallId: 10, primaryIpId: 11, serverId: 12 },
      publicIpv4: '192.0.2.44',
      status: 'provisioned',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('cloud-config');
    expect(JSON.stringify(result)).not.toContain('hcloud-token');
  });

  it('snapshots verified cloud-init bytes before provider awaits', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture);
    const expectedCloudInit = Buffer.from(fixture.cloudInitBytes);

    const convergence = convergeHetznerSingleNodeProvisioning({
      ...fixture,
      api: provider.api,
      waitForAction: provider.waitForAction,
      recordMutationAttempt: provider.recordMutationAttempt,
      recordResource: provider.recordResource,
    });
    fixture.cloudInitBytes.fill(0);
    await convergence;

    expect(provider.api.createServer.mock.calls[0][0].user_data).toBe(
      expectedCloudInit.toString('utf8'),
    );
  });

  it('rejects non-round-tripping UTF-8 before any provider await', async () => {
    const fixture = await makeFixture(Buffer.from([0xc3, 0x28]));
    const provider = makeProvider(fixture);

    await expect(
      convergeHetznerSingleNodeProvisioning({
        ...fixture,
        api: provider.api,
        waitForAction: provider.waitForAction,
        recordMutationAttempt: provider.recordMutationAttempt,
        recordResource: provider.recordResource,
      }),
    ).rejects.toThrow(
      'hetznerProvisioning.cloudInitBytes must be exact UTF-8 text.',
    );
    expect(provider.api.listServers).not.toHaveBeenCalled();
    expect(provider.recordMutationAttempt).not.toHaveBeenCalled();
  });

  it('never posts after a durable fence exists without a recoverable resource', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture, {
      attemptRecordFailure: true,
    });
    const base = {
      ...fixture,
      api: provider.api,
      waitForAction: provider.waitForAction,
      recordMutationAttempt: provider.recordMutationAttempt,
      recordResource: provider.recordResource,
    };

    await expect(
      convergeHetznerSingleNodeProvisioning(base),
    ).rejects.toMatchObject({
      code: 'HETZNER_PROVISIONING_ATTEMPT_RECORD_FAILED',
      role: 'firewall',
    });
    expect(provider.state.attempts).toHaveLength(1);
    expect(provider.api.createFirewall).not.toHaveBeenCalled();

    await expect(
      convergeHetznerSingleNodeProvisioning({
        ...base,
        storedMutationAttempts: attemptsByRole(provider.state.attempts),
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_PROVISIONING_RECOVERY_REQUIRED',
      role: 'firewall',
    });
    expect(provider.api.createFirewall).not.toHaveBeenCalled();
    expect(provider.recordMutationAttempt).toHaveBeenCalledTimes(1);
  });

  it('adopts an exact complete deployment without creating again', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture);
    const input = {
      ...fixture,
      api: provider.api,
      waitForAction: provider.waitForAction,
      recordMutationAttempt: provider.recordMutationAttempt,
      recordResource: provider.recordResource,
    };
    const first = await convergeHetznerSingleNodeProvisioning(input);
    provider.state.creationOrder.length = 0;
    provider.state.records.length = 0;
    jest.clearAllMocks();

    const second = await convergeHetznerSingleNodeProvisioning(input);

    expect(second).toEqual(first);
    expect(provider.state.creationOrder).toEqual([]);
    expect(provider.api.createFirewall).not.toHaveBeenCalled();
    expect(provider.api.createPrimaryIp).not.toHaveBeenCalled();
    expect(provider.api.createServer).not.toHaveBeenCalled();
    expect(provider.state.records.map((record) => record.role)).toEqual([
      'firewall',
      'primaryIp',
      'server',
    ]);
  });

  it('inspects exact resources once through only six read capabilities', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture);
    const result = await convergeHetznerSingleNodeProvisioning({
      ...fixture,
      api: provider.api,
      waitForAction: provider.waitForAction,
      recordMutationAttempt: provider.recordMutationAttempt,
      recordResource: provider.recordResource,
    });
    const createCounts = {
      firewall: provider.api.createFirewall.mock.calls.length,
      primaryIp: provider.api.createPrimaryIp.mock.calls.length,
      server: provider.api.createServer.mock.calls.length,
    };
    let mutationCapabilityRead = false;
    const readApi = {
      listFirewalls: provider.api.listFirewalls,
      getFirewall: provider.api.getFirewall,
      listPrimaryIps: provider.api.listPrimaryIps,
      getPrimaryIp: provider.api.getPrimaryIp,
      listServers: provider.api.listServers,
      getServer: provider.api.getServer,
    };
    Object.defineProperty(readApi, 'createServer', {
      enumerable: true,
      get() {
        mutationCapabilityRead = true;
        throw new Error('mutation capability must remain unreachable');
      },
    });

    await expect(
      inspectHetznerSingleNodeProvisioning({
        intent: fixture.intent,
        storedResourceIds: {
          firewall: result.resources.firewallId,
          primaryIp: result.resources.primaryIpId,
          server: result.resources.serverId,
        },
        api: readApi,
      }),
    ).resolves.toEqual({
      firewall: { id: 10, state: 'exact', publicIpv4: null },
      primaryIp: { id: 11, state: 'exact', publicIpv4: '192.0.2.44' },
      server: { id: 12, state: 'exact', publicIpv4: '192.0.2.44' },
    });
    expect(mutationCapabilityRead).toBe(false);
    expect(provider.api.createFirewall).toHaveBeenCalledTimes(
      createCounts.firewall,
    );
    expect(provider.api.createPrimaryIp).toHaveBeenCalledTimes(
      createCounts.primaryIp,
    );
    expect(provider.api.createServer).toHaveBeenCalledTimes(
      createCounts.server,
    );
  });

  it('maps transitional and drifted exact-ownership resources without polling', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture);
    const result = await convergeHetznerSingleNodeProvisioning({
      ...fixture,
      api: provider.api,
      waitForAction: provider.waitForAction,
      recordMutationAttempt: provider.recordMutationAttempt,
      recordResource: provider.recordResource,
    });
    const input = {
      intent: fixture.intent,
      storedResourceIds: {
        firewall: result.resources.firewallId,
        primaryIp: result.resources.primaryIpId,
        server: result.resources.serverId,
      },
      api: provider.api,
    };

    provider.state.servers[0].status = 'initializing';
    await expect(
      inspectHetznerSingleNodeProvisioning(input),
    ).resolves.toMatchObject({
      firewall: { state: 'exact' },
      primaryIp: { state: 'exact' },
      server: { state: 'settling' },
    });

    provider.state.servers[0].status = 'running';
    const exactFirewallRules = clone(provider.state.firewalls[0].rules);
    provider.state.firewalls[0].rules = [];
    await expect(
      inspectHetznerSingleNodeProvisioning(input),
    ).resolves.toMatchObject({
      firewall: { state: 'conflict' },
      primaryIp: { state: 'exact' },
      server: { state: 'exact' },
    });

    provider.state.firewalls[0].rules = exactFirewallRules;
    provider.state.servers[0].publicIpv4.ip = '192.0.2.91';
    await expect(
      inspectHetznerSingleNodeProvisioning(input),
    ).resolves.toMatchObject({
      firewall: { state: 'exact' },
      primaryIp: { state: 'exact', publicIpv4: '192.0.2.44' },
      server: { state: 'conflict', publicIpv4: '192.0.2.91' },
    });
    expect(provider.wait).not.toHaveBeenCalled();
  });

  it.each(['firewall', 'primaryIp', 'server'])(
    'recovers a lost %s create response from inventory without a duplicate POST',
    async (role) => {
      const fixture = await makeFixture();
      const provider = makeProvider(fixture, { lostResponseRole: role });

      const result = await convergeHetznerSingleNodeProvisioning({
        ...fixture,
        api: provider.api,
        waitForAction: provider.waitForAction,
        recordMutationAttempt: provider.recordMutationAttempt,
        recordResource: provider.recordResource,
      });

      expect(result.status).toBe('provisioned');
      expect(provider.api.createFirewall).toHaveBeenCalledTimes(1);
      expect(provider.api.createPrimaryIp).toHaveBeenCalledTimes(1);
      expect(provider.api.createServer).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain('hcloud-token-secret');
    },
  );

  it('durably releases a definitely rejected server fence so apply can retry and destroy can clean earlier resources', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture, {
      rejectedCreateRole: 'server',
    });
    const input = {
      ...fixture,
      api: provider.api,
      waitForAction: provider.waitForAction,
      recordMutationAttempt: provider.recordMutationAttempt,
      recordMutationRejection: provider.recordMutationRejection,
      recordResource: provider.recordResource,
    };

    const failure = await convergeHetznerSingleNodeProvisioning(input).catch(
      (/** @type {any} */ error) => error,
    );

    expect(failure).toMatchObject({
      code: 'HETZNER_PROVISIONING_MUTATION_REJECTED',
      role: 'server',
    });
    expect(failure.message).not.toContain('hcloud-token-secret');
    expect(provider.state.rejections.map((record) => record.role)).toEqual([
      'server',
    ]);
    expect(provider.state.records.map((record) => record.role)).toEqual([
      'firewall',
      'primaryIp',
    ]);

    const storedMutationAttempts = attemptsByRole(provider.state.attempts);
    storedMutationAttempts.server = null;
    const storedResourceIds = {
      firewall: provider.state.records.find(
        (record) => record.role === 'firewall',
      ).providerResourceId,
      primaryIp: provider.state.records.find(
        (record) => record.role === 'primaryIp',
      ).providerResourceId,
      server: null,
    };
    await expect(
      convergeHetznerSingleNodeProvisioning({
        ...input,
        storedMutationAttempts,
        storedResourceIds,
      }),
    ).resolves.toMatchObject({ status: 'provisioned' });
    expect(provider.api.createFirewall).toHaveBeenCalledTimes(1);
    expect(provider.api.createPrimaryIp).toHaveBeenCalledTimes(1);
    expect(provider.api.createServer).toHaveBeenCalledTimes(2);
  });

  it('keeps the fence when a confirmed rejection cannot be recorded durably', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture, {
      rejectedCreateRole: 'firewall',
      rejectionRecordFailure: true,
    });

    await expect(
      convergeHetznerSingleNodeProvisioning({
        ...fixture,
        api: provider.api,
        waitForAction: provider.waitForAction,
        recordMutationAttempt: provider.recordMutationAttempt,
        recordMutationRejection: provider.recordMutationRejection,
        recordResource: provider.recordResource,
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_PROVISIONING_REJECTION_RECORD_FAILED',
      role: 'firewall',
    });
    expect(provider.state.attempts).toHaveLength(1);
    expect(provider.state.records).toHaveLength(0);
  });

  it('polls initializing server, firewall, and IP attachment states to settled in one convergence without reposting', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture, {
      transitionalServer: true,
      settleDuringWait: true,
    });

    await expect(
      convergeHetznerSingleNodeProvisioning({
        ...fixture,
        api: provider.api,
        waitForAction: provider.waitForAction,
        recordMutationAttempt: provider.recordMutationAttempt,
        recordResource: provider.recordResource,
        wait: provider.wait,
      }),
    ).resolves.toMatchObject({ status: 'provisioned' });

    expect(provider.wait).toHaveBeenCalledTimes(3);
    expect(provider.wait).toHaveBeenNthCalledWith(
      1,
      HETZNER_PROVISIONING_SETTLE_RETRY_DELAY_MILLISECONDS,
    );
    expect(provider.state.servers[0].firewalls).toEqual([
      { id: provider.state.firewalls[0].id, status: 'applied' },
    ]);
    expect(provider.api.createFirewall).toHaveBeenCalledTimes(1);
    expect(provider.api.createPrimaryIp).toHaveBeenCalledTimes(1);
    expect(provider.api.createServer).toHaveBeenCalledTimes(1);
  });

  it('stops bounded settle polling safely without duplicate POSTs', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture, {
      transitionalServer: true,
    });

    await expect(
      convergeHetznerSingleNodeProvisioning({
        ...fixture,
        api: provider.api,
        waitForAction: provider.waitForAction,
        recordMutationAttempt: provider.recordMutationAttempt,
        recordResource: provider.recordResource,
        wait: provider.wait,
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_PROVISIONING_NOT_SETTLED',
      role: 'server',
    });

    expect(provider.api.getServer).toHaveBeenCalledTimes(
      HETZNER_PROVISIONING_MAX_SETTLE_ATTEMPTS + 1,
    );
    expect(provider.wait).toHaveBeenCalledTimes(
      HETZNER_PROVISIONING_MAX_SETTLE_ATTEMPTS - 1,
    );
    expect(provider.api.createFirewall).toHaveBeenCalledTimes(1);
    expect(provider.api.createPrimaryIp).toHaveBeenCalledTimes(1);
    expect(provider.api.createServer).toHaveBeenCalledTimes(1);
  });

  it('rejects an assigned public IPv6 when the persisted server spec disables it', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture);
    const base = {
      ...fixture,
      api: provider.api,
      waitForAction: provider.waitForAction,
      recordMutationAttempt: provider.recordMutationAttempt,
      recordResource: provider.recordResource,
    };
    await convergeHetznerSingleNodeProvisioning(base);
    provider.state.servers[0].publicIpv6 = {
      id: 71,
      ip: '2001:db8:1234::/64',
      blocked: false,
    };

    await expect(
      convergeHetznerSingleNodeProvisioning({
        ...base,
        storedMutationAttempts: attemptsByRole(provider.state.attempts),
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_PROVISIONING_SPEC_MISMATCH',
      role: 'server',
    });
    expect(provider.api.createServer).toHaveBeenCalledTimes(1);
  });

  it('rejects ownership conflicts and exact-ownership spec drift before downstream mutation', async () => {
    const fixture = await makeFixture();
    const conflicting = makeProvider(fixture);
    conflicting.state.firewalls.push({
      id: 90,
      name: fixture.intent.resources.firewall.ownership.name,
      labels: { unexpected: 'owner' },
      rules: [],
      appliedTo: [],
    });

    await expect(
      convergeHetznerSingleNodeProvisioning({
        ...fixture,
        api: conflicting.api,
        waitForAction: conflicting.waitForAction,
        recordMutationAttempt: conflicting.recordMutationAttempt,
        recordResource: conflicting.recordResource,
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_PROVISIONING_CONFLICT',
      role: 'firewall',
    });
    expect(conflicting.api.createFirewall).not.toHaveBeenCalled();

    const drifting = makeProvider(fixture);
    drifting.state.firewalls.push({
      id: 91,
      name: fixture.intent.resources.firewall.ownership.name,
      labels: fixture.intent.resources.firewall.ownership.labels,
      rules: [],
      appliedTo: [],
    });
    await expect(
      convergeHetznerSingleNodeProvisioning({
        ...fixture,
        api: drifting.api,
        waitForAction: drifting.waitForAction,
        recordMutationAttempt: drifting.recordMutationAttempt,
        recordResource: drifting.recordResource,
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_PROVISIONING_SPEC_MISMATCH',
      role: 'firewall',
    });
    expect(drifting.api.createPrimaryIp).not.toHaveBeenCalled();

    const multiple = makeProvider(fixture);
    for (const id of [92, 93]) {
      multiple.state.firewalls.push({
        id,
        name: fixture.intent.resources.firewall.ownership.name,
        labels: fixture.intent.resources.firewall.ownership.labels,
        rules: fixture.intent.resources.firewall.desiredSpec.rules,
        appliedTo: [],
      });
    }
    await expect(
      convergeHetznerSingleNodeProvisioning({
        ...fixture,
        api: multiple.api,
        waitForAction: multiple.waitForAction,
        recordMutationAttempt: multiple.recordMutationAttempt,
        recordResource: multiple.recordResource,
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_PROVISIONING_CONFLICT',
      role: 'firewall',
    });
    expect(multiple.api.createFirewall).not.toHaveBeenCalled();
  });

  it('stops on action failure and redacts provider errors', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture, { waitFailure: true });

    let caught;
    try {
      await convergeHetznerSingleNodeProvisioning({
        ...fixture,
        api: provider.api,
        waitForAction: provider.waitForAction,
        recordMutationAttempt: provider.recordMutationAttempt,
        recordResource: provider.recordResource,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'HETZNER_PROVISIONING_ACTION_FAILED',
      role: 'firewall',
    });
    expect(String(caught)).not.toContain('hcloud-token-secret');
    expect(provider.state.records.map((record) => record.role)).toEqual([
      'firewall',
    ]);
    expect(provider.state.events).toEqual([
      'attempt:firewall',
      'create:firewall',
      'resource:firewall',
      'wait:100',
    ]);
    expect(provider.api.createPrimaryIp).not.toHaveBeenCalled();
  });

  it('records an adopted provider ID before a failing readback', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture, {
      readbackFailureRole: 'firewall',
    });
    provider.state.firewalls.push({
      id: 91,
      name: fixture.intent.resources.firewall.ownership.name,
      labels: fixture.intent.resources.firewall.ownership.labels,
      rules: fixture.intent.resources.firewall.desiredSpec.rules,
      appliedTo: [],
    });

    await expect(
      convergeHetznerSingleNodeProvisioning({
        ...fixture,
        api: provider.api,
        waitForAction: provider.waitForAction,
        recordMutationAttempt: provider.recordMutationAttempt,
        recordResource: provider.recordResource,
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_PROVISIONING_READBACK_FAILED',
      role: 'firewall',
    });
    expect(provider.state.records).toEqual([
      expect.objectContaining({
        role: 'firewall',
        providerResourceId: 91,
      }),
    ]);
    expect(provider.recordMutationAttempt).not.toHaveBeenCalled();
  });

  it('resumes after durable-record failure by adopting the already-created resource', async () => {
    const fixture = await makeFixture();
    const provider = makeProvider(fixture, { recordFailure: true });
    const input = {
      ...fixture,
      api: provider.api,
      waitForAction: provider.waitForAction,
      recordMutationAttempt: provider.recordMutationAttempt,
      recordResource: provider.recordResource,
    };

    await expect(
      convergeHetznerSingleNodeProvisioning(input),
    ).rejects.toMatchObject({
      code: 'HETZNER_PROVISIONING_RECORD_FAILED',
      role: 'firewall',
    });
    expect(provider.api.createFirewall).toHaveBeenCalledTimes(1);
    expect(provider.api.createPrimaryIp).not.toHaveBeenCalled();

    const result = await convergeHetznerSingleNodeProvisioning({
      ...input,
      storedMutationAttempts: attemptsByRole(provider.state.attempts),
    });

    expect(result.status).toBe('provisioned');
    expect(provider.api.createFirewall).toHaveBeenCalledTimes(1);
    expect(provider.api.createPrimaryIp).toHaveBeenCalledTimes(1);
    expect(provider.api.createServer).toHaveBeenCalledTimes(1);
  });

  it('content-addresses exact intent and refuses tampering or credential fields', async () => {
    const fixture = await makeFixture();
    expect(validateHetznerSingleNodeProvisioningIntent(fixture.intent)).toEqual(
      fixture.intent,
    );
    expect(Object.isFrozen(fixture.intent)).toBe(true);
    expect(fixture.intent.provisioningIntentId).toMatch(
      /^wshpi1_[A-Za-z0-9_-]{43}$/u,
    );
    const attempt = createHetznerProvisioningMutationAttempt(
      fixture.intent,
      'firewall',
    );
    expect(
      validateHetznerProvisioningMutationAttempt(
        clone(attempt),
        fixture.intent,
        'firewall',
      ),
    ).toEqual(attempt);
    expect(attempt).toMatchObject({
      attemptId: expect.stringMatching(/^wshma1_[A-Za-z0-9_-]{43}$/u),
      provisioningIntentId: fixture.intent.provisioningIntentId,
      role: 'firewall',
      operation: 'create',
    });
    const resourceRecord = createHetznerProvisionedResourceRecord(
      fixture.intent,
      'firewall',
      71,
    );
    expect(
      validateHetznerProvisionedResourceRecord(
        clone(resourceRecord),
        fixture.intent,
        'firewall',
      ),
    ).toEqual(resourceRecord);

    const tampered = clone(fixture.intent);
    tampered.resources.firewall.desiredSpec.rules[0].port = '2222';
    expect(() => validateHetznerSingleNodeProvisioningIntent(tampered)).toThrow(
      /resources do not match/u,
    );

    const provider = makeProvider(fixture);
    await expect(
      convergeHetznerSingleNodeProvisioning({
        ...fixture,
        api: provider.api,
        waitForAction: provider.waitForAction,
        recordMutationAttempt: provider.recordMutationAttempt,
        recordResource: provider.recordResource,
        token: 'hcloud-token-secret',
      }),
    ).rejects.not.toThrow('hcloud-token-secret');
    expect(provider.api.createFirewall).not.toHaveBeenCalled();
  });
});
