import { describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../../../src/core/runtime/content-id.js';
import {
  HETZNER_DESTRUCTION_MAX_SETTLE_ATTEMPTS,
  HETZNER_DESTRUCTION_SETTLE_RETRY_DELAY_MILLISECONDS,
  convergeHetznerSingleNodeDestruction,
  createHetznerDeletionRecord,
  createHetznerDestructionAttempt,
  validateHetznerDeletionRecord,
  validateHetznerDestructionAttempt,
} from '../../../../src/core/runtime/providers/hetzner/single-node-destruction.js';
import { createHetznerSingleNodeProvisioningIntent } from '../../../../src/core/runtime/providers/hetzner/single-node-provisioning.js';
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
const IDS = Object.freeze({ firewall: 10, primaryIp: 11, server: 12 });

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
        ...LOCATION,
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
      app: { id: 'destroy-test' },
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
    deployment: { id: 'production' },
    appId: 'destroy-test',
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

async function makeIntent() {
  const plan = await resolveHetznerSingleNodePlan({
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
  const cloudInitBytes = Buffer.from('#cloud-config\n');
  return createHetznerSingleNodeProvisioningIntent({
    plan,
    incarnationId: createSingleNodeDeploymentIncarnationId(
      Buffer.alloc(32, 27),
    ),
    ownershipNonces: {
      firewall: sha256Base64Url('destroy-firewall-nonce'),
      primaryIp: sha256Base64Url('destroy-primary-ip-nonce'),
      server: sha256Base64Url('destroy-server-nonce'),
    },
    cloudInitDigest: digest(cloudInitBytes),
  });
}

/**
 * @param {Awaited<ReturnType<typeof makeIntent>>} intent
 * @param {{initiallyAbsent?: boolean, lostResponseRole?: string, attemptFailure?: boolean, deletionRecordFailure?: boolean, waitFailure?: boolean, leaveServerPresent?: boolean}} [options]
 */
function makeProvider(intent, options = {}) {
  const resources = {
    firewall: {
      id: IDS.firewall,
      name: intent.resources.firewall.ownership.name,
      labels: intent.resources.firewall.ownership.labels,
    },
    primaryIp: {
      id: IDS.primaryIp,
      name: intent.resources.primaryIp.ownership.name,
      labels: intent.resources.primaryIp.ownership.labels,
    },
    server: {
      id: IDS.server,
      name: intent.resources.server.ownership.name,
      labels: intent.resources.server.ownership.labels,
    },
  };
  /** @type {Record<string, any[]>} */
  const state = {
    firewall: options.initiallyAbsent ? [] : [resources.firewall],
    primaryIp: options.initiallyAbsent ? [] : [resources.primaryIp],
    server: options.initiallyAbsent ? [] : [resources.server],
  };
  const events = /** @type {string[]} */ ([]);
  const attempts = /** @type {any[]} */ ([]);
  const deletions = /** @type {any[]} */ ([]);

  /** @param {string} role @param {any} query */
  function list(role, query) {
    return state[role].filter(
      (item) =>
        (query.name === undefined || item.name === query.name) &&
        (query.labelSelector === undefined ||
          query.labelSelector.split(',').every((/** @type {string} */ part) => {
            const separator = part.indexOf('=');
            return (
              item.labels[part.slice(0, separator)] ===
              part.slice(separator + 1)
            );
          })),
    );
  }

  /** @param {string} role @param {number} id */
  function get(role, id) {
    const item = state[role].find((candidate) => candidate.id === id);
    if (item === undefined) {
      const error = /** @type {Error & {status?: number}} */ (
        new Error('provider error may contain hcloud-secret-token')
      );
      error.status = 404;
      throw error;
    }
    return item;
  }

  /** @param {string} role @param {number} id */
  function remove(role, id) {
    events.push(`delete:${role}`);
    if (!(role === 'server' && options.leaveServerPresent)) {
      state[role] = state[role].filter((item) => item.id !== id);
    }
    if (options.lostResponseRole === role) {
      throw new Error('transport error carried hcloud-secret-token');
    }
    return role === 'server'
      ? { id: 500, status: 'running', error: null }
      : undefined;
  }

  const api = {
    listServers: jest.fn(async (/** @type {any} */ query) =>
      list('server', query),
    ),
    getServer: jest.fn(async (/** @type {number} */ id) => get('server', id)),
    deleteServer: jest.fn(async (/** @type {number} */ id) =>
      remove('server', id),
    ),
    listPrimaryIps: jest.fn(async (/** @type {any} */ query) =>
      list('primaryIp', query),
    ),
    getPrimaryIp: jest.fn(async (/** @type {number} */ id) =>
      get('primaryIp', id),
    ),
    deletePrimaryIp: jest.fn(async (/** @type {number} */ id) =>
      remove('primaryIp', id),
    ),
    listFirewalls: jest.fn(async (/** @type {any} */ query) =>
      list('firewall', query),
    ),
    getFirewall: jest.fn(async (/** @type {number} */ id) =>
      get('firewall', id),
    ),
    deleteFirewall: jest.fn(async (/** @type {number} */ id) =>
      remove('firewall', id),
    ),
  };
  const waitForAction = jest.fn(async (/** @type {number} */ id) => {
    events.push(`wait:${id}`);
    if (options.waitFailure) {
      throw new Error('action error carried hcloud-secret-token');
    }
  });
  const recordDestroyAttempt = jest.fn(async (/** @type {any} */ record) => {
    events.push(`attempt:${record.role}`);
    attempts.push(record);
    if (options.attemptFailure) {
      throw new Error('storage error carried hcloud-secret-token');
    }
  });
  const recordDeletion = jest.fn(async (/** @type {any} */ record) => {
    events.push(`absent:${record.role}`);
    deletions.push(record);
    if (options.deletionRecordFailure) {
      throw new Error('storage error carried hcloud-secret-token');
    }
  });
  return {
    api,
    state,
    events,
    attempts,
    deletions,
    waitForAction,
    recordDestroyAttempt,
    recordDeletion,
  };
}

/** @param {ReturnType<typeof makeProvider>} provider */
function convergenceEffects(provider) {
  return {
    api: provider.api,
    waitForAction: provider.waitForAction,
    recordDestroyAttempt: provider.recordDestroyAttempt,
    recordDeletion: provider.recordDeletion,
    wait: async () => undefined,
  };
}

describe('Hetzner single-node destruction convergence', () => {
  it('deletes exact persisted IDs in dependency order and durably records every boundary', async () => {
    const intent = await makeIntent();
    const provider = makeProvider(intent);

    const result = await convergeHetznerSingleNodeDestruction({
      intent,
      storedResourceIds: IDS,
      ...convergenceEffects(provider),
    });

    expect(provider.events).toEqual([
      'attempt:server',
      'delete:server',
      'wait:500',
      'absent:server',
      'attempt:primaryIp',
      'delete:primaryIp',
      'absent:primaryIp',
      'attempt:firewall',
      'delete:firewall',
      'absent:firewall',
    ]);
    expect(provider.api.deleteServer).toHaveBeenCalledWith(IDS.server);
    expect(provider.api.deletePrimaryIp).toHaveBeenCalledWith(IDS.primaryIp);
    expect(provider.api.deleteFirewall).toHaveBeenCalledWith(IDS.firewall);
    expect(provider.attempts).toHaveLength(3);
    expect(provider.deletions).toHaveLength(3);
    for (const attempt of provider.attempts) {
      expect(
        validateHetznerDestructionAttempt(
          attempt,
          intent,
          attempt.role,
          /** @type {Readonly<Record<string, number>>} */ (IDS)[attempt.role],
        ),
      ).toEqual(attempt);
    }
    for (const deletion of provider.deletions) {
      const attempt = provider.attempts.find(
        (candidate) => candidate.role === deletion.role,
      );
      expect(
        validateHetznerDeletionRecord(
          deletion,
          intent,
          deletion.role,
          /** @type {Readonly<Record<string, number>>} */ (IDS)[deletion.role],
          attempt,
        ),
      ).toEqual(deletion);
    }
    expect(result).toMatchObject({
      status: 'destroyed',
      provisioningIntentId: intent.provisioningIntentId,
      resources: {
        server: { providerResourceId: IDS.server, state: 'absent' },
        primaryIp: { providerResourceId: IDS.primaryIp, state: 'absent' },
        firewall: { providerResourceId: IDS.firewall, state: 'absent' },
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('hcloud-secret-token');
  });

  it('does not issue DELETE until its exact attempt is durably recorded', async () => {
    const intent = await makeIntent();
    const provider = makeProvider(intent, { attemptFailure: true });

    await expect(
      convergeHetznerSingleNodeDestruction({
        intent,
        storedResourceIds: IDS,
        ...convergenceEffects(provider),
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_DESTRUCTION_ATTEMPT_RECORD_FAILED',
      role: 'server',
    });
    expect(provider.api.deleteServer).not.toHaveBeenCalled();
    expect(provider.api.deletePrimaryIp).not.toHaveBeenCalled();
    expect(provider.events).toEqual(['attempt:server']);
  });

  it('recovers an ambiguous DELETE only by proving the same owned ID absent', async () => {
    const intent = await makeIntent();
    const provider = makeProvider(intent, { lostResponseRole: 'server' });

    const result = await convergeHetznerSingleNodeDestruction({
      intent,
      storedResourceIds: IDS,
      ...convergenceEffects(provider),
    });

    expect(result.status).toBe('destroyed');
    expect(provider.events.slice(0, 3)).toEqual([
      'attempt:server',
      'delete:server',
      'absent:server',
    ]);
    expect(JSON.stringify(result)).not.toContain('hcloud-secret-token');
  });

  it('reuses a stored attempt to retry the same exact provider ID', async () => {
    const intent = await makeIntent();
    const provider = makeProvider(intent);
    const serverAttempt = createHetznerDestructionAttempt(
      intent,
      'server',
      IDS.server,
    );

    await convergeHetznerSingleNodeDestruction({
      intent,
      storedResourceIds: IDS,
      storedDestroyAttempts: {
        server: serverAttempt,
        primaryIp: null,
        firewall: null,
      },
      ...convergenceEffects(provider),
    });

    expect(provider.recordDestroyAttempt).toHaveBeenCalledTimes(2);
    expect(provider.recordDestroyAttempt).not.toHaveBeenCalledWith(
      serverAttempt,
    );
    expect(provider.events[0]).toBe('delete:server');
  });

  it('records already-absent exact IDs without inventing delete attempts', async () => {
    const intent = await makeIntent();
    const provider = makeProvider(intent, { initiallyAbsent: true });

    await convergeHetznerSingleNodeDestruction({
      intent,
      storedResourceIds: IDS,
      ...convergenceEffects(provider),
    });

    expect(provider.recordDestroyAttempt).not.toHaveBeenCalled();
    expect(provider.api.deleteServer).not.toHaveBeenCalled();
    expect(provider.api.deletePrimaryIp).not.toHaveBeenCalled();
    expect(provider.api.deleteFirewall).not.toHaveBeenCalled();
    expect(provider.deletions).toHaveLength(3);
    expect(
      provider.deletions.every(
        (deletion) => deletion.destroyAttemptId === null,
      ),
    ).toBe(true);
  });

  it('accepts stored deletion evidence only while the exact ID remains absent', async () => {
    const intent = await makeIntent();
    const provider = makeProvider(intent, { initiallyAbsent: true });
    const attempt = createHetznerDestructionAttempt(
      intent,
      'server',
      IDS.server,
    );
    const deletion = createHetznerDeletionRecord(
      intent,
      'server',
      IDS.server,
      attempt,
    );

    await convergeHetznerSingleNodeDestruction({
      intent,
      storedResourceIds: IDS,
      storedDestroyAttempts: {
        server: attempt,
        primaryIp: null,
        firewall: null,
      },
      storedDeletionRecords: {
        server: deletion,
        primaryIp: null,
        firewall: null,
      },
      ...convergenceEffects(provider),
    });
    expect(provider.recordDeletion).toHaveBeenCalledTimes(2);
    expect(provider.recordDeletion).not.toHaveBeenCalledWith(deletion);

    provider.state.server.push({
      id: IDS.server,
      name: intent.resources.server.ownership.name,
      labels: intent.resources.server.ownership.labels,
    });
    await expect(
      convergeHetznerSingleNodeDestruction({
        intent,
        storedResourceIds: IDS,
        storedDestroyAttempts: {
          server: attempt,
          primaryIp: null,
          firewall: null,
        },
        storedDeletionRecords: {
          server: deletion,
          primaryIp: null,
          firewall: null,
        },
        ...convergenceEffects(provider),
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_DESTRUCTION_RESOURCE_REAPPEARED',
      role: 'server',
    });
    expect(provider.api.deleteServer).not.toHaveBeenCalled();
  });

  it('fails closed on ownership drift and never deletes a classified conflict', async () => {
    const intent = await makeIntent();
    const provider = makeProvider(intent);
    provider.state.server[0].labels = {
      ...provider.state.server[0].labels,
      'wharfie.dev/spec': 'sha256-wrong',
    };

    await expect(
      convergeHetznerSingleNodeDestruction({
        intent,
        storedResourceIds: IDS,
        ...convergenceEffects(provider),
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_DESTRUCTION_CONFLICT',
      role: 'server',
    });
    expect(provider.recordDestroyAttempt).not.toHaveBeenCalled();
    expect(provider.api.deleteServer).not.toHaveBeenCalled();
  });

  it('will not use ownership discovery as deletion authority without a stored ID', async () => {
    const intent = await makeIntent();
    const provider = makeProvider(intent);

    await expect(
      convergeHetznerSingleNodeDestruction({
        intent,
        storedResourceIds: { ...IDS, server: null },
        ...convergenceEffects(provider),
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_DESTRUCTION_RESOURCE_ID_REQUIRED',
      role: 'server',
    });
    expect(provider.api.deleteServer).not.toHaveBeenCalled();
  });

  it('does not advance to dependent deletion while an action leaves the server present', async () => {
    const intent = await makeIntent();
    const provider = makeProvider(intent, {
      waitFailure: true,
      leaveServerPresent: true,
    });

    await expect(
      convergeHetznerSingleNodeDestruction({
        intent,
        storedResourceIds: IDS,
        ...convergenceEffects(provider),
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_DESTRUCTION_ACTION_UNRESOLVED',
      role: 'server',
    });
    expect(provider.api.deletePrimaryIp).not.toHaveBeenCalled();
    expect(provider.api.deleteFirewall).not.toHaveBeenCalled();
    expect(provider.events.join(' ')).not.toContain('hcloud-secret-token');
  });

  it('polls a still-visible server to absence without issuing a second DELETE', async () => {
    const intent = await makeIntent();
    const provider = makeProvider(intent, { leaveServerPresent: true });
    const wait = jest.fn(async (milliseconds) => {
      expect(milliseconds).toBe(
        HETZNER_DESTRUCTION_SETTLE_RETRY_DELAY_MILLISECONDS,
      );
      provider.state.server = [];
    });

    await expect(
      convergeHetznerSingleNodeDestruction({
        intent,
        storedResourceIds: IDS,
        ...convergenceEffects(provider),
        wait,
      }),
    ).resolves.toMatchObject({ status: 'destroyed' });

    expect(wait).toHaveBeenCalledTimes(1);
    expect(provider.api.deleteServer).toHaveBeenCalledTimes(1);
    expect(provider.api.deletePrimaryIp).toHaveBeenCalledTimes(1);
    expect(provider.api.deleteFirewall).toHaveBeenCalledTimes(1);
    expect(provider.events.indexOf('absent:server')).toBeLessThan(
      provider.events.indexOf('delete:primaryIp'),
    );
  });

  it('leaves a bounded settle timeout durably retryable without false absence', async () => {
    const intent = await makeIntent();
    const provider = makeProvider(intent, { leaveServerPresent: true });
    const wait = jest.fn(async () => undefined);

    await expect(
      convergeHetznerSingleNodeDestruction({
        intent,
        storedResourceIds: IDS,
        ...convergenceEffects(provider),
        wait,
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_DESTRUCTION_NOT_SETTLED',
      role: 'server',
    });

    expect(wait).toHaveBeenCalledTimes(
      HETZNER_DESTRUCTION_MAX_SETTLE_ATTEMPTS - 1,
    );
    expect(provider.api.deleteServer).toHaveBeenCalledTimes(1);
    expect(provider.api.deletePrimaryIp).not.toHaveBeenCalled();
    expect(provider.api.deleteFirewall).not.toHaveBeenCalled();
    expect(provider.attempts).toHaveLength(1);
    expect(provider.deletions).toHaveLength(0);

    provider.state.server = [];
    await expect(
      convergeHetznerSingleNodeDestruction({
        intent,
        storedResourceIds: IDS,
        storedDestroyAttempts: {
          server: provider.attempts[0],
          primaryIp: null,
          firewall: null,
        },
        ...convergenceEffects(provider),
        wait,
      }),
    ).resolves.toMatchObject({ status: 'destroyed' });
    expect(provider.api.deleteServer).toHaveBeenCalledTimes(1);
  });

  it('rejects tampered or mismatched persisted evidence before provider effects', async () => {
    const intent = await makeIntent();
    const provider = makeProvider(intent);
    const attempt = createHetznerDestructionAttempt(
      intent,
      'server',
      IDS.server,
    );
    const tampered = /** @type {any} */ (clone(attempt));
    tampered.providerResourceId = IDS.primaryIp;

    await expect(
      convergeHetznerSingleNodeDestruction({
        intent,
        storedResourceIds: IDS,
        storedDestroyAttempts: {
          server: tampered,
          primaryIp: null,
          firewall: null,
        },
        ...convergenceEffects(provider),
      }),
    ).rejects.toThrow(
      'hetznerDestruction.storedDestroyAttempts.server does not match its exact destroy authority.',
    );
    expect(provider.api.listServers).not.toHaveBeenCalled();
    expect(provider.recordDestroyAttempt).not.toHaveBeenCalled();
  });

  it('fails safely if durable absence recording fails after provider absence', async () => {
    const intent = await makeIntent();
    const provider = makeProvider(intent, { deletionRecordFailure: true });

    await expect(
      convergeHetznerSingleNodeDestruction({
        intent,
        storedResourceIds: IDS,
        ...convergenceEffects(provider),
      }),
    ).rejects.toMatchObject({
      code: 'HETZNER_DESTRUCTION_DELETION_RECORD_FAILED',
      role: 'server',
    });
    expect(provider.api.deleteServer).toHaveBeenCalledTimes(1);
    expect(provider.api.deletePrimaryIp).not.toHaveBeenCalled();
    expect(JSON.stringify(provider.events)).not.toContain(
      'hcloud-secret-token',
    );
  });
});
