import { describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../../../src/core/runtime/content-id.js';
import {
  createHetznerDeletionRecord,
  createHetznerDestructionAttempt,
} from '../../../../src/core/runtime/providers/hetzner/single-node-destruction.js';
import { createHetznerSingleNodeDestroyCoordinator } from '../../../../src/core/runtime/providers/hetzner/single-node-destroy.js';
import {
  createHetznerProvisionedResourceRecord,
  createHetznerProvisioningMutationAttempt,
  createHetznerSingleNodeProvisioningIntent,
} from '../../../../src/core/runtime/providers/hetzner/single-node-provisioning.js';
import {
  HETZNER_SMALL_SERVER_TYPE_CANDIDATES,
  resolveHetznerSingleNodePlan,
} from '../../../../src/core/runtime/providers/hetzner/single-node-plan.js';
import {
  advanceSingleNodeDeploymentJournal,
  completeSingleNodeDeploymentMutation,
  createSingleNodeDeploymentJournal,
  prepareSingleNodeDeploymentMutation,
  recordSingleNodeDeploymentDeletion,
  recordSingleNodeDeploymentResource,
  validateSingleNodeDeploymentJournalSuccessor,
} from '../../../../src/core/runtime/single-node-deployment-journal.js';
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
const IDS = /** @type {Readonly<Record<string, number>>} */ (
  Object.freeze({ firewall: 101, primaryIp: 102, server: 103 })
);
const PUBLIC_IPV4 = '192.0.2.44';

/** @param {string|Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
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
      app: { id: 'destroy-app' },
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
    deployment: { id: 'production' },
    appId: 'destroy-app',
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

async function makeProvisionedJournal() {
  const desired = makeDesired();
  const plan = await resolveHetznerSingleNodePlan({
    desired,
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
  const providerIntent = createHetznerSingleNodeProvisioningIntent({
    plan,
    incarnationId: createSingleNodeDeploymentIncarnationId(
      Buffer.alloc(32, 37),
    ),
    ownershipNonces: {
      firewall: sha256Base64Url('firewall-nonce'),
      primaryIp: sha256Base64Url('primary-ip-nonce'),
      server: sha256Base64Url('server-nonce'),
    },
    cloudInitDigest: digest('#cloud-config\n'),
  });
  let journal = createSingleNodeDeploymentJournal({
    desired,
    providerIntent: { provider: 'hetzner', intent: providerIntent },
  });
  journal = advanceSingleNodeDeploymentJournal(journal, 'provisioning');
  for (const role of ['firewall', 'primaryIp', 'server']) {
    journal = prepareSingleNodeDeploymentMutation(
      journal,
      createHetznerProvisioningMutationAttempt(providerIntent, role),
    );
    journal = completeSingleNodeDeploymentMutation(
      journal,
      createHetznerProvisionedResourceRecord(providerIntent, role, IDS[role]),
    );
    if (role !== 'firewall') {
      journal = recordSingleNodeDeploymentResource(journal, {
        provider: 'hetzner',
        role,
        providerResourceId: IDS[role],
        publicIpv4: PUBLIC_IPV4,
        state: 'present',
      });
    }
  }
  return advanceSingleNodeDeploymentJournal(journal, 'provisioned');
}

/**
 * @param {string} role
 */
async function makePreparedJournal(role) {
  const complete = await makeProvisionedJournal();
  let journal = createSingleNodeDeploymentJournal({
    desired: complete.desired,
    providerIntent: complete.providerIntent,
  });
  journal = advanceSingleNodeDeploymentJournal(journal, 'provisioning');
  return prepareSingleNodeDeploymentMutation(
    journal,
    createHetznerProvisioningMutationAttempt(
      journal.providerIntent.intent,
      role,
    ),
  );
}

/**
 * @param {{failFirstDestroy?: boolean, failAfterPreparedRecovery?: boolean, missingJournal?: boolean, bindingError?: Error, preparedCreateOutcome?: 'found'|'pending'|'pending-then-found', destroyedJournal?: boolean}} [options]
 */
async function makeHarness(options = {}) {
  /** @type {Readonly<Record<string, any>>|null} */
  let journal = options.missingJournal
    ? null
    : options.preparedCreateOutcome
      ? await makePreparedJournal('firewall')
      : await makeProvisionedJournal();
  if (options.destroyedJournal && journal !== null) {
    journal = advanceSingleNodeDeploymentJournal(journal, 'destroying');
    for (const role of ['server', 'primaryIp', 'firewall']) {
      const resource = journal.resources.find(
        (/** @type {Record<string, any>} */ entry) => entry.role === role,
      );
      if (resource === undefined) continue;
      journal = recordSingleNodeDeploymentDeletion(
        journal,
        createHetznerDeletionRecord(
          journal.providerIntent.intent,
          role,
          resource.providerResourceId,
          null,
        ),
      );
    }
    journal = advanceSingleNodeDeploymentJournal(journal, 'destroyed');
  }
  /** @type {string[]} */
  const events = [];
  let convergeCalls = 0;
  let preparedRecoveryCalls = 0;
  /** @type {Function|undefined} */
  let convergeWait;
  const release = jest.fn(async () => undefined);
  const readToken = jest.fn(async () => {
    events.push('token');
    return 'test-secret-token';
  });
  const createApi = jest.fn(() => {
    events.push('api');
    return {};
  });
  const requireCredentialBinding = jest.fn(
    async (/** @type {Record<string, any>} */ value) => {
      events.push('require-binding');
      if (options.bindingError) throw options.bindingError;
      return {
        schemaVersion: 1,
        kind: 'hetznerCredentialBindingEvidence',
        deploymentInstanceId: value.deploymentInstanceId,
        bindingId: `whcb1_${sha256Base64Url('binding')}`,
      };
    },
  );
  const dependencies = {
    acquireOperationLock: async () => {
      events.push('lock');
      return release;
    },
    readToken,
    requireCredentialBinding,
    createApi,
    createJournalStore: () => ({
      prepareStorage: async () => {
        events.push('storage');
      },
      read: async () => journal,
      commit: async (/** @type {Record<string, any>} */ request) => {
        if (
          journal === null ||
          request.expectedGeneration !== journal.generation ||
          request.expectedJournalId !== journal.journalId
        ) {
          throw new Error('test CAS mismatch');
        }
        journal = validateSingleNodeDeploymentJournalSuccessor(
          journal,
          request.next,
        );
        events.push(`journal:${journal.phase}:${journal.generation}`);
        return journal;
      },
    }),
    reconcilePreparedMutation: async (
      /** @type {Record<string, any>} */ value,
    ) => {
      preparedRecoveryCalls += 1;
      events.push(`recover-create:${value.mutationAttempt.role}`);
      if (
        options.preparedCreateOutcome !== 'found' &&
        !(
          options.preparedCreateOutcome === 'pending-then-found' &&
          preparedRecoveryCalls > 1
        )
      ) {
        const error = /** @type {Error & {code?: string, role?: string}} */ (
          new Error('prepared create cleanup remains pending')
        );
        error.code = 'HETZNER_PROVISIONING_DESTROY_RECOVERY_PENDING';
        error.role = value.mutationAttempt.role;
        throw error;
      }
      return createHetznerProvisionedResourceRecord(
        value.intent,
        value.mutationAttempt.role,
        IDS[value.mutationAttempt.role],
      );
    },
    waitForAction: async () => undefined,
    wait: jest.fn(async () => undefined),
    convergeDestruction: async (/** @type {Record<string, any>} */ value) => {
      convergeCalls += 1;
      convergeWait = value.wait;
      if (options.failAfterPreparedRecovery === true && convergeCalls === 1) {
        throw new Error('injected crash after prepared create recovery');
      }
      const attempts = { ...value.storedDestroyAttempts };
      const deletions = { ...value.storedDeletionRecords };
      for (const role of ['server', 'primaryIp', 'firewall']) {
        if (value.storedResourceIds[role] === null) {
          events.push(`never-created:${role}`);
          continue;
        }
        if (deletions[role] !== null) {
          events.push(`recover:${role}`);
          continue;
        }
        if (attempts[role] === null) {
          attempts[role] = createHetznerDestructionAttempt(
            value.intent,
            role,
            value.storedResourceIds[role],
          );
          events.push(`attempt:${role}`);
          await value.recordDestroyAttempt(attempts[role]);
        }
        deletions[role] = createHetznerDeletionRecord(
          value.intent,
          role,
          value.storedResourceIds[role],
          attempts[role],
        );
        events.push(`deletion:${role}`);
        await value.recordDeletion(deletions[role]);
        if (
          options.failFirstDestroy === true &&
          convergeCalls === 1 &&
          role === 'server'
        ) {
          throw new Error('injected destroy coordinator crash');
        }
      }
      return {
        schemaVersion: 1,
        kind: 'hetznerSingleNodeDestructionResult',
        provisioningIntentId: value.intent.provisioningIntentId,
        planId: value.intent.plan.planId,
        providerSpecId: value.intent.plan.providerSpec.providerSpecId,
        deploymentInstanceId: value.intent.plan.deploymentInstanceId,
        incarnationId: value.intent.incarnationId,
        status: 'destroyed',
        resources: Object.fromEntries(
          ['server', 'primaryIp', 'firewall'].map((role) => [
            role,
            {
              providerResourceId: value.storedResourceIds[role],
              state: 'absent',
              deletionId: deletions[role]?.deletionId ?? null,
            },
          ]),
        ),
      };
    },
  };
  const initial = journal;
  return {
    input: {
      appId: initial?.desired.intent.appId ?? 'destroy-app',
      deploymentInstanceId:
        initial?.deploymentInstanceId ?? makeDesired().deploymentInstanceId,
      dataRoot: '/tmp/wharfie-destroy-test/data',
    },
    dependencies,
    events,
    release,
    readToken,
    requireCredentialBinding,
    createApi,
    wait: dependencies.wait,
    getJournal: () => journal,
    getPreparedRecoveryCalls: () => preparedRecoveryCalls,
    getConvergeWait: () => convergeWait,
  };
}

describe('Hetzner single-node destroy coordinator', () => {
  it('persists ordered deletion evidence before marking the journal destroyed', async () => {
    const harness = await makeHarness();
    const coordinator = createHetznerSingleNodeDestroyCoordinator(
      harness.dependencies,
    );
    const before = /** @type {Readonly<Record<string, any>>} */ (
      harness.getJournal()
    );

    const result = await coordinator.destroy(harness.input);
    const journal = /** @type {Readonly<Record<string, any>>} */ (
      harness.getJournal()
    );

    expect(result).toMatchObject({
      kind: 'hetznerSingleNodeDestroyResult',
      provider: 'hetzner',
      status: 'destroyed',
      appId: harness.input.appId,
      deploymentInstanceId: harness.input.deploymentInstanceId,
      incarnationId: before.incarnationId,
      provisioningIntentId: before.providerIntent.intent.provisioningIntentId,
    });
    expect(journal.phase).toBe('destroyed');
    expect(
      journal.resources.every(
        (/** @type {Record<string, any>} */ resource) =>
          resource.state === 'absent',
      ),
    ).toBe(true);
    expect(journal.destroyAttempts).toHaveLength(3);
    expect(journal.deletionRecords).toHaveLength(3);
    expect(journal.providerIntent).toEqual(before.providerIntent);
    expect(harness.events.indexOf('storage')).toBeLessThan(
      harness.events.indexOf('token'),
    );
    expect(harness.events.indexOf('require-binding')).toBeLessThan(
      harness.events.indexOf('api'),
    );
    expect(
      harness.events.findIndex((event) =>
        event.startsWith('journal:destroying'),
      ),
    ).toBeLessThan(harness.events.indexOf('attempt:server'));
    expect(harness.events.indexOf('deletion:server')).toBeLessThan(
      harness.events.indexOf('attempt:primaryIp'),
    );
    expect(JSON.stringify(result)).not.toContain('test-secret-token');
    expect(JSON.stringify(result)).not.toContain(String(IDS.server));
    expect(harness.release).toHaveBeenCalledTimes(1);
    expect(harness.getConvergeWait()).toBe(harness.wait);
  });

  it('recovers after one recorded deletion without issuing its attempt again', async () => {
    const harness = await makeHarness({ failFirstDestroy: true });
    const coordinator = createHetznerSingleNodeDestroyCoordinator(
      harness.dependencies,
    );

    await expect(coordinator.destroy(harness.input)).rejects.toThrow(
      'injected destroy coordinator crash',
    );
    const interrupted = /** @type {Readonly<Record<string, any>>} */ (
      harness.getJournal()
    );
    expect(interrupted.phase).toBe('destroying');
    expect(
      interrupted.resources.find(
        (/** @type {Record<string, any>} */ resource) =>
          resource.role === 'server',
      ).state,
    ).toBe('absent');

    const result = await coordinator.destroy(harness.input);

    expect(result.incarnationId).toBe(interrupted.incarnationId);
    expect(harness.getJournal()?.phase).toBe('destroyed');
    expect(
      harness.events.filter((event) => event === 'attempt:server'),
    ).toHaveLength(1);
    expect(harness.events).toContain('recover:server');
    expect(harness.release).toHaveBeenCalledTimes(2);
  });

  it('atomically adopts an exact owned prepared create before destroying it', async () => {
    const harness = await makeHarness({ preparedCreateOutcome: 'found' });
    const coordinator = createHetznerSingleNodeDestroyCoordinator(
      harness.dependencies,
    );

    await expect(coordinator.destroy(harness.input)).resolves.toMatchObject({
      status: 'destroyed',
    });
    const journal = /** @type {Readonly<Record<string, any>>} */ (
      harness.getJournal()
    );
    const mutation = journal.mutationAttempts.find(
      (/** @type {Record<string, any>} */ attempt) =>
        attempt.role === 'firewall',
    );
    const resource = journal.resources.find(
      (/** @type {Record<string, any>} */ entry) => entry.role === 'firewall',
    );

    expect(mutation).toMatchObject({
      state: 'succeeded',
      providerResourceId: IDS.firewall,
    });
    expect(resource).toMatchObject({
      providerResourceId: IDS.firewall,
      state: 'absent',
    });
    expect(harness.events.indexOf('recover-create:firewall')).toBeLessThan(
      harness.events.indexOf('attempt:firewall'),
    );
    expect(harness.getPreparedRecoveryCalls()).toBe(1);
  });

  it('keeps a clean prepared-create inventory retryable in destroying', async () => {
    const harness = await makeHarness({ preparedCreateOutcome: 'pending' });
    const coordinator = createHetznerSingleNodeDestroyCoordinator(
      harness.dependencies,
    );

    await expect(coordinator.destroy(harness.input)).rejects.toMatchObject({
      code: 'HETZNER_PROVISIONING_DESTROY_RECOVERY_PENDING',
      role: 'firewall',
    });
    const journal = /** @type {Readonly<Record<string, any>>} */ (
      harness.getJournal()
    );
    const mutation = journal.mutationAttempts.find(
      (/** @type {Record<string, any>} */ attempt) =>
        attempt.role === 'firewall',
    );

    expect(mutation).toMatchObject({
      state: 'prepared',
      providerResourceId: null,
    });
    expect(journal.phase).toBe('destroying');
    expect(journal.resources).toEqual([]);
    expect(journal.destroyAttempts).toEqual([]);
    expect(journal.deletionRecords).toEqual([]);
    expect(harness.getPreparedRecoveryCalls()).toBe(1);
  });

  it('adopts and deletes a prepared create when it becomes visible on retry', async () => {
    const harness = await makeHarness({
      preparedCreateOutcome: 'pending-then-found',
    });
    const coordinator = createHetznerSingleNodeDestroyCoordinator(
      harness.dependencies,
    );

    await expect(coordinator.destroy(harness.input)).rejects.toMatchObject({
      code: 'HETZNER_PROVISIONING_DESTROY_RECOVERY_PENDING',
    });
    const interrupted = /** @type {Readonly<Record<string, any>>} */ (
      harness.getJournal()
    );
    expect(interrupted.phase).toBe('destroying');
    expect(interrupted.mutationAttempts[0]).toMatchObject({
      state: 'prepared',
      providerResourceId: null,
    });
    expect(harness.getPreparedRecoveryCalls()).toBe(1);

    await expect(coordinator.destroy(harness.input)).resolves.toMatchObject({
      status: 'destroyed',
    });
    expect(harness.getJournal()?.phase).toBe('destroyed');
    expect(harness.getJournal()?.mutationAttempts[0]).toMatchObject({
      state: 'succeeded',
      providerResourceId: IDS.firewall,
    });
    expect(harness.getJournal()?.resources[0]).toMatchObject({
      providerResourceId: IDS.firewall,
      state: 'absent',
    });
    expect(harness.getPreparedRecoveryCalls()).toBe(2);
  });

  it('recovers a crash after durable exact adoption without reinventory', async () => {
    const harness = await makeHarness({
      preparedCreateOutcome: 'found',
      failAfterPreparedRecovery: true,
    });
    const coordinator = createHetznerSingleNodeDestroyCoordinator(
      harness.dependencies,
    );

    await expect(coordinator.destroy(harness.input)).rejects.toThrow(
      'injected crash after prepared create recovery',
    );
    const interrupted = /** @type {Readonly<Record<string, any>>} */ (
      harness.getJournal()
    );
    expect(interrupted.phase).toBe('destroying');
    expect(interrupted.mutationAttempts[0]).toMatchObject({
      state: 'succeeded',
      providerResourceId: IDS.firewall,
    });
    expect(interrupted.resources[0]).toMatchObject({
      providerResourceId: IDS.firewall,
      state: 'present',
    });
    expect(harness.getPreparedRecoveryCalls()).toBe(1);

    await expect(coordinator.destroy(harness.input)).resolves.toMatchObject({
      status: 'destroyed',
    });
    expect(harness.getJournal()?.phase).toBe('destroyed');
    expect(harness.getPreparedRecoveryCalls()).toBe(1);
  });

  it.each([
    ['missing', new Error('credential binding missing')],
    ['wrong-token', new Error('credential binding mismatch')],
  ])(
    'does not mutate the journal or provider when the binding is %s',
    async (_name, bindingError) => {
      const harness = await makeHarness({ bindingError });
      const coordinator = createHetznerSingleNodeDestroyCoordinator(
        harness.dependencies,
      );
      const before = /** @type {Readonly<Record<string, any>>} */ (
        harness.getJournal()
      );

      await expect(coordinator.destroy(harness.input)).rejects.toBe(
        bindingError,
      );

      expect(harness.getJournal()).toBe(before);
      expect(harness.events.some((event) => event.startsWith('journal:'))).toBe(
        false,
      );
      expect(harness.createApi).not.toHaveBeenCalled();
      expect(harness.getPreparedRecoveryCalls()).toBe(0);
      expect(harness.release).toHaveBeenCalledTimes(1);
    },
  );

  it('replays an already-destroyed journal without credentials or provider reads', async () => {
    const harness = await makeHarness({ destroyedJournal: true });
    const coordinator = createHetznerSingleNodeDestroyCoordinator(
      harness.dependencies,
    );

    await expect(coordinator.destroy(harness.input)).resolves.toMatchObject({
      status: 'destroyed',
    });
    expect(harness.readToken).not.toHaveBeenCalled();
    expect(harness.requireCredentialBinding).not.toHaveBeenCalled();
    expect(harness.createApi).not.toHaveBeenCalled();
    expect(harness.release).toHaveBeenCalledTimes(1);
  });

  it('rejects missing local authority before reading credentials or provider state', async () => {
    const harness = await makeHarness({ missingJournal: true });
    const coordinator = createHetznerSingleNodeDestroyCoordinator(
      harness.dependencies,
    );

    await expect(coordinator.destroy(harness.input)).rejects.toThrow(
      'no durable local deployment authority',
    );

    expect(harness.readToken).not.toHaveBeenCalled();
    expect(harness.createApi).not.toHaveBeenCalled();
    expect(harness.release).toHaveBeenCalledTimes(1);
  });
});
