import { createHash } from 'node:crypto';
import path from 'node:path';

import { describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../../src/core/runtime/artifact-record.js';
import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../../../src/core/runtime/content-id.js';
import { sortCanonicalJsonValue } from '../../../../src/core/runtime/canonical-order.js';
import { createHetznerSingleNodeApplyCoordinator } from '../../../../src/core/runtime/providers/hetzner/single-node-apply.js';
import {
  createHetznerProvisionedResourceRecord,
  createHetznerProvisioningMutationAttempt,
} from '../../../../src/core/runtime/providers/hetzner/single-node-provisioning.js';
import {
  HETZNER_SMALL_SERVER_TYPE_CANDIDATES,
  resolveHetznerSingleNodePlan,
} from '../../../../src/core/runtime/providers/hetzner/single-node-plan.js';
import {
  createSingleNodeDeploymentJournal,
  getSingleNodeDeploymentCurrentRelease,
  validateSingleNodeDeploymentJournalSuccessor,
} from '../../../../src/core/runtime/single-node-deployment-journal.js';
import { createSingleNodeDeploymentDesired } from '../../../../src/core/runtime/single-node-deployment-desired.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../../../../src/core/runtime/single-node-deployment-intent.js';
import { SINGLE_NODE_DEPLOYMENT_ROOT } from '../../../../src/core/runtime/single-node-cloud-init.js';
import {
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
} from '../../../../src/core/runtime/single-node-remote-activation.js';

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
const PUBLIC_IPV4 = '192.0.2.44';
const HOST_FINGERPRINT = `SHA256:${Buffer.alloc(32, 29)
  .toString('base64')
  .replace(/=+$/u, '')}`;

/** @param {string|Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string} value */
function wireString(value) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.byteLength);
  return Buffer.concat([length, bytes]);
}

function makeSshIdentity() {
  const blob = Buffer.concat([
    wireString('ssh-ed25519'),
    wireString(Buffer.alloc(32, 17).toString('binary')),
  ]);
  return Object.freeze({
    privateKeyPath: '/tmp/wharfie-apply-test/id_ed25519',
    publicKey: `ssh-ed25519 ${blob.toString('base64')}`,
    publicKeyFingerprint: `SHA256:${createHash('sha256')
      .update(blob)
      .digest('base64')
      .replace(/=+$/u, '')}`,
    knownHostsPath: '/tmp/wharfie-apply-test/known_hosts',
  });
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

function makeFixture() {
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
  const observation = Object.freeze({
    artifactId: artifactRecord.artifactId,
    byteDigest: artifactRecord.byteDigest,
    size: artifactRecord.size,
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
    provider: { kind: 'hetzner', location: LOCATION.name },
  });
  return Object.freeze({
    revision,
    artifactRecord,
    observation,
    intent,
    desired: createSingleNodeDeploymentDesired({
      intent,
      revision,
      artifactRecord,
      observation,
    }),
  });
}

/**
 * @param {Readonly<Record<string, any>>} desired
 * @param {string} incarnationId
 * @param {Readonly<Record<string, any>>} sshIdentity
 */
function activationEvidence(desired, incarnationId, sshIdentity) {
  const payload = sortCanonicalJsonValue({
    schemaVersion: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
    kind: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND,
    deploymentInstanceId: desired.deploymentInstanceId,
    incarnationId,
    desiredRevisionId: desired.desiredRevisionId,
    address: PUBLIC_IPV4,
    sshHostKey: {
      algorithm: 'ssh-ed25519',
      fingerprint: HOST_FINGERPRINT,
    },
    bootstrap: {
      contractVersion: 1,
      sshPublicKeyFingerprint: sshIdentity.publicKeyFingerprint,
    },
    artifact: {
      artifactId: desired.artifact.artifactId,
      revisionId: desired.artifact.revisionId,
      byteDigest: desired.artifact.byteDigest,
      size: desired.artifact.size,
      remotePath: path.posix.join(
        SINGLE_NODE_DEPLOYMENT_ROOT,
        desired.deploymentInstanceId,
        'artifacts',
        desired.artifact.artifactId,
        'app-sea',
      ),
    },
    service: {
      appId: desired.intent.appId,
      unit: `wharfie-${desired.intent.appId}.service`,
      health: 'healthy',
      activeArtifactId: desired.artifact.artifactId,
      activeRevisionId: desired.artifact.revisionId,
    },
  });
  return Object.freeze({
    ...payload,
    activationEvidenceId: createCanonicalJsonSha256Id({
      domain: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
      prefix: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
      value: payload,
      valuePath: 'testActivationEvidence',
    }),
  });
}

/**
 * @param {{failFirstProvision?: boolean, failFirstPlanRead?: boolean, rejectFirstServer?: boolean}} [options]
 */
function makeHarness(options = {}) {
  const fixture = makeFixture();
  const sshIdentity = makeSshIdentity();
  /** @type {string[]} */
  const events = [];
  /** @type {Readonly<Record<string, any>>|null} */
  let journal = null;
  const providerRoles = new Set();
  let convergeCalls = 0;
  /** @type {undefined|((milliseconds: number) => Promise<void>)} */
  let convergeWait;
  let planCalls = 0;
  let entropyByte = 1;
  let serviceHealthy = false;
  const release = jest.fn(async () => undefined);
  const api = {
    listLocations: async () => [LOCATION],
    listServerTypes: async () =>
      HETZNER_SMALL_SERVER_TYPE_CANDIDATES.map(serverType),
    listImages: async () => [IMAGE],
    listFirewalls: async () => (providerRoles.has('firewall') ? [{}] : []),
    listPrimaryIps: async () => (providerRoles.has('primaryIp') ? [{}] : []),
    listServers: async () => (providerRoles.has('server') ? [{}] : []),
    getFirewall: async () => {
      events.push('credential-read-firewall');
      if (providerRoles.has('firewall')) return {};
      throw Object.assign(new Error('missing firewall'), { status: 404 });
    },
    getPrimaryIp: async () => {
      events.push('credential-read-primaryIp');
      if (providerRoles.has('primaryIp')) return {};
      throw Object.assign(new Error('missing primary IP'), { status: 404 });
    },
    getServer: async () => {
      events.push('credential-read-server');
      if (providerRoles.has('server')) return {};
      throw Object.assign(new Error('missing server'), { status: 404 });
    },
  };
  const dependencies = {
    acquireOperationLock: async () => {
      events.push('lock');
      return release;
    },
    readToken: async () => {
      events.push('token');
      return 'test-secret-token';
    },
    bindCredential: async (/** @type {Record<string, any>} */ value) => {
      events.push('bind');
      return {
        schemaVersion: 1,
        kind: 'hetznerCredentialBindingEvidence',
        deploymentInstanceId: value.deploymentInstanceId,
        bindingId: `whcb1_${sha256Base64Url('binding')}`,
      };
    },
    createApi: () => {
      events.push('api');
      return api;
    },
    resolvePlan: async (/** @type {Record<string, any>} */ value) => {
      planCalls += 1;
      events.push('plan-fresh');
      if (options.failFirstPlanRead === true && planCalls === 1) {
        throw new Error('injected credential validation failure');
      }
      return await resolveHetznerSingleNodePlan(value);
    },
    createJournalStore: () => ({
      prepareStorage: async () => {
        events.push('storage');
      },
      read: async () => journal,
      initialize: async (/** @type {unknown} */ value) => {
        if (journal !== null) throw new Error('test duplicate initialize');
        journal = createSingleNodeDeploymentJournal(value);
        events.push('journal-initialize');
        return journal;
      },
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
        events.push(`journal-${journal.phase}-${journal.generation}`);
        return journal;
      },
    }),
    ensureSshIdentity: async () => {
      events.push('identity');
      return sshIdentity;
    },
    waitForAction: async () => undefined,
    convergeProvisioning: async (/** @type {Record<string, any>} */ value) => {
      convergeCalls += 1;
      convergeWait = value.wait;
      events.push(`converge-${convergeCalls}`);
      /** @type {Record<string, number>} */
      const ids = { firewall: 101, primaryIp: 102, server: 103 };
      for (const role of ['firewall', 'primaryIp', 'server']) {
        if (value.storedResourceIds[role] !== null) {
          if (!providerRoles.has(role)) {
            throw new Error(`injected ${role} provider drift`);
          }
          await value.recordResource(
            createHetznerProvisionedResourceRecord(
              value.intent,
              role,
              ids[role],
            ),
          );
          continue;
        }
        events.push(`attempt-${role}`);
        const mutationAttempt = createHetznerProvisioningMutationAttempt(
          value.intent,
          role,
        );
        await value.recordMutationAttempt(mutationAttempt);
        if (
          options.rejectFirstServer === true &&
          convergeCalls === 1 &&
          role === 'server'
        ) {
          events.push('reject-server');
          await value.recordMutationRejection(mutationAttempt);
          throw new Error('injected definite server rejection');
        }
        providerRoles.add(role);
        await value.recordResource(
          createHetznerProvisionedResourceRecord(value.intent, role, ids[role]),
        );
        if (
          options.failFirstProvision === true &&
          convergeCalls === 1 &&
          role === 'firewall'
        ) {
          throw new Error('injected coordinator crash');
        }
      }
      return {
        schemaVersion: 1,
        kind: 'hetznerSingleNodeProvisioningResult',
        provisioningIntentId: value.intent.provisioningIntentId,
        planId: value.intent.plan.planId,
        providerSpecId: value.intent.plan.providerSpec.providerSpecId,
        desiredRevisionId: value.intent.plan.desired.desiredRevisionId,
        deploymentInstanceId: value.intent.plan.deploymentInstanceId,
        incarnationId: value.intent.incarnationId,
        resources: {
          firewallId: ids.firewall,
          primaryIpId: ids.primaryIp,
          serverId: ids.server,
        },
        publicIpv4: PUBLIC_IPV4,
        status: 'provisioned',
      };
    },
    enrollSshHost: async () => {
      events.push('host-key');
      return {
        address: PUBLIC_IPV4,
        algorithm: 'ssh-ed25519',
        fingerprint: HOST_FINGERPRINT,
      };
    },
    activate: async (/** @type {Record<string, any>} */ value) => {
      events.push('activate');
      expect(value.retainedArtifactIds).toEqual([
        value.desired.artifact.artifactId,
      ]);
      serviceHealthy = true;
      if (Object.hasOwn(value, 'artifactSource')) {
        await value.artifactSource.close();
      }
      return activationEvidence(
        value.desired,
        value.incarnationId,
        sshIdentity,
      );
    },
    randomBytes: jest.fn(() => Buffer.alloc(32, entropyByte++)),
    wait: async () => undefined,
  };
  return {
    fixture,
    events,
    dependencies,
    release,
    getJournal: () => journal,
    getConvergeWait: () => convergeWait,
    removeProviderRole: (/** @type {string} */ role) =>
      providerRoles.delete(role),
    stopService: () => {
      serviceHealthy = false;
    },
    isServiceHealthy: () => serviceHealthy,
  };
}

/** @param {Readonly<Record<string, any>>} fixture */
function makeSourceRequest(fixture) {
  const close = jest.fn(async () => undefined);
  return {
    request: {
      intent: fixture.intent,
      revision: fixture.revision,
      artifactRecord: fixture.artifactRecord,
      observation: fixture.observation,
      artifactSource: {
        observation: fixture.observation,
        createReadStream: jest.fn(),
        verifyUnchanged: jest.fn(),
        close,
      },
      dataRoot: '/tmp/wharfie-apply-test/data',
    },
    close,
  };
}

describe('Hetzner single-node apply coordinator', () => {
  it('orders durable create fences, activation evidence, and source cleanup', async () => {
    const harness = makeHarness();
    const source = makeSourceRequest(harness.fixture);
    const coordinator = createHetznerSingleNodeApplyCoordinator(
      harness.dependencies,
    );
    const result = await coordinator.apply(source.request);
    const journal = /** @type {Readonly<Record<string, any>>} */ (
      harness.getJournal()
    );
    const currentRelease = /** @type {Readonly<Record<string, any>>} */ (
      getSingleNodeDeploymentCurrentRelease(journal)
    );

    expect(result).toMatchObject({
      kind: 'hetznerSingleNodeApplyResult',
      provider: 'hetzner',
      status: 'active',
      deploymentInstanceId: harness.fixture.desired.deploymentInstanceId,
      desiredRevisionId: harness.fixture.desired.desiredRevisionId,
      publicIpv4: PUBLIC_IPV4,
      artifactId: harness.fixture.artifactRecord.artifactId,
    });
    expect(journal.phase).toBe('active');
    expect(currentRelease.activation.activationEvidenceId).toBe(
      result.activationEvidenceId,
    );
    expect(harness.events.indexOf('storage')).toBeLessThan(
      harness.events.indexOf('token'),
    );
    expect(harness.events.indexOf('plan-fresh')).toBeLessThan(
      harness.events.indexOf('bind'),
    );
    expect(harness.events.indexOf('bind')).toBeLessThan(
      harness.events.indexOf('identity'),
    );
    expect(harness.events.indexOf('journal-initialize')).toBeLessThan(
      harness.events.indexOf('attempt-firewall'),
    );
    expect(harness.events.indexOf('host-key')).toBeLessThan(
      harness.events.indexOf('activate'),
    );
    expect(harness.getConvergeWait()).toBe(harness.dependencies.wait);
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(harness.release).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('test-secret-token');
    expect(JSON.stringify(result)).not.toContain('id_ed25519');
  });

  it('recovers the exact journal after a crash without minting new authority', async () => {
    const harness = makeHarness({ failFirstProvision: true });
    const coordinator = createHetznerSingleNodeApplyCoordinator(
      harness.dependencies,
    );
    const first = makeSourceRequest(harness.fixture);

    await expect(coordinator.apply(first.request)).rejects.toThrow(
      'injected coordinator crash',
    );
    const interrupted = /** @type {Readonly<Record<string, any>>} */ (
      harness.getJournal()
    );
    expect(interrupted.phase).toBe('provisioning');
    expect(interrupted.resources).toHaveLength(1);
    expect(first.close).toHaveBeenCalledTimes(1);

    const second = makeSourceRequest(harness.fixture);
    const result = await coordinator.apply({
      desired: harness.fixture.desired,
      revision: harness.fixture.revision,
      artifactRecord: harness.fixture.artifactRecord,
      observation: harness.fixture.observation,
      artifactSource: second.request.artifactSource,
      dataRoot: second.request.dataRoot,
    });

    expect(result.incarnationId).toBe(interrupted.incarnationId);
    expect(harness.getJournal()?.phase).toBe('active');
    expect(
      harness.events.filter((event) => event === 'plan-fresh'),
    ).toHaveLength(1);
    expect(harness.events).toContain('credential-read-firewall');
    expect(harness.dependencies.randomBytes).toHaveBeenCalledTimes(4);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(harness.release).toHaveBeenCalledTimes(2);
  });

  it('durably releases a definitely rejected create fence and retries without replacing earlier resources', async () => {
    const harness = makeHarness({ rejectFirstServer: true });
    const coordinator = createHetznerSingleNodeApplyCoordinator(
      harness.dependencies,
    );
    const first = makeSourceRequest(harness.fixture);

    await expect(coordinator.apply(first.request)).rejects.toThrow(
      'injected definite server rejection',
    );
    const rejected = /** @type {Readonly<Record<string, any>>} */ (
      harness.getJournal()
    );
    expect(rejected.phase).toBe('provisioning');
    expect(
      rejected.resources
        .map((/** @type {Record<string, any>} */ resource) => resource.role)
        .sort(),
    ).toEqual(['firewall', 'primaryIp']);
    expect(
      rejected.mutationAttempts
        .map((/** @type {Record<string, any>} */ attempt) => attempt.role)
        .sort(),
    ).toEqual(['firewall', 'primaryIp']);
    expect(harness.events).toContain('reject-server');

    const second = makeSourceRequest(harness.fixture);
    await expect(coordinator.apply(second.request)).resolves.toMatchObject({
      status: 'active',
      incarnationId: rejected.incarnationId,
    });
    expect(
      harness.events.filter((event) => event === 'attempt-firewall'),
    ).toHaveLength(1);
    expect(
      harness.events.filter((event) => event === 'attempt-primaryIp'),
    ).toHaveLength(1);
    expect(
      harness.events.filter((event) => event === 'attempt-server'),
    ).toHaveLength(2);
  });

  it('does not bind a credential until its first authenticated plan read succeeds', async () => {
    const harness = makeHarness({ failFirstPlanRead: true });
    const coordinator = createHetznerSingleNodeApplyCoordinator(
      harness.dependencies,
    );
    const first = makeSourceRequest(harness.fixture);

    await expect(coordinator.apply(first.request)).rejects.toThrow(
      'injected credential validation failure',
    );
    expect(harness.getJournal()).toBeNull();
    expect(harness.events).not.toContain('bind');
    expect(harness.events).not.toContain('identity');
    expect(first.close).toHaveBeenCalledTimes(1);

    const second = makeSourceRequest(harness.fixture);
    await expect(coordinator.apply(second.request)).resolves.toMatchObject({
      status: 'active',
    });

    expect(
      harness.events.filter((event) => event === 'plan-fresh'),
    ).toHaveLength(2);
    expect(harness.events.filter((event) => event === 'bind')).toHaveLength(1);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(harness.release).toHaveBeenCalledTimes(2);
  });

  it('uses durable provider authority and re-converges remote service health for active apply', async () => {
    const harness = makeHarness();
    const coordinator = createHetznerSingleNodeApplyCoordinator(
      harness.dependencies,
    );
    const first = makeSourceRequest(harness.fixture);
    const initial = await coordinator.apply(first.request);
    harness.stopService();
    expect(harness.isServiceHealthy()).toBe(false);

    const second = makeSourceRequest(harness.fixture);
    const recovered = await coordinator.apply({
      desired: harness.fixture.desired,
      revision: harness.fixture.revision,
      artifactRecord: harness.fixture.artifactRecord,
      observation: harness.fixture.observation,
      artifactSource: second.request.artifactSource,
      dataRoot: second.request.dataRoot,
    });

    expect(recovered.status).toBe('active');
    expect(recovered.journalId).toBe(initial.journalId);
    expect(harness.isServiceHealthy()).toBe(true);
    expect(
      harness.events.filter((event) => event === 'plan-fresh'),
    ).toHaveLength(1);
    expect(harness.events).toContain('credential-read-server');
    expect(
      harness.events.filter((event) => event.startsWith('converge-')),
    ).toHaveLength(2);
    expect(harness.events.filter((event) => event === 'activate')).toHaveLength(
      2,
    );
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('fails active apply closed when exact durable provider resources drift', async () => {
    const harness = makeHarness();
    const coordinator = createHetznerSingleNodeApplyCoordinator(
      harness.dependencies,
    );
    const first = makeSourceRequest(harness.fixture);
    await coordinator.apply(first.request);
    harness.removeProviderRole('server');

    const second = makeSourceRequest(harness.fixture);
    await expect(
      coordinator.apply({
        desired: harness.fixture.desired,
        revision: harness.fixture.revision,
        artifactRecord: harness.fixture.artifactRecord,
        observation: harness.fixture.observation,
        artifactSource: second.request.artifactSource,
        dataRoot: second.request.dataRoot,
      }),
    ).rejects.toThrow('injected server provider drift');

    expect(harness.events).toContain('credential-read-server');
    expect(harness.events.filter((event) => event === 'activate')).toHaveLength(
      1,
    );
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(harness.release).toHaveBeenCalledTimes(2);
  });
});
