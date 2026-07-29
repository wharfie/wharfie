import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from '@jest/globals';

import { createApplicationRevision } from '../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../src/core/runtime/artifact-record.js';
import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  SingleNodeDeploymentJournalConflictError,
  SingleNodeDeploymentJournalInvalidError,
  advanceSingleNodeDeploymentJournal,
  completeSingleNodeDeploymentMutation,
  createSingleNodeDeploymentJournal,
  createSingleNodeDeploymentJournalStore,
  getSingleNodeDeploymentDestructionRecoveryState,
  getSingleNodeDeploymentMutationAttempt,
  getSingleNodeDeploymentProvisioningRecoveryState,
  prepareSingleNodeDeploymentDestruction,
  prepareSingleNodeDeploymentMutation,
  recordSingleNodeDeploymentActivation,
  recordSingleNodeDeploymentDeletion,
  recordSingleNodeDeploymentResource,
  recordSingleNodeDeploymentSshHost,
  validateSingleNodeDeploymentJournal,
  validateSingleNodeDeploymentJournalSuccessor,
} from '../../src/core/runtime/single-node-deployment-journal.js';
import {
  createHetznerDeletionRecord,
  createHetznerDestructionAttempt,
} from '../../src/core/runtime/providers/hetzner/single-node-destruction.js';
import {
  createHetznerProvisionedResourceRecord,
  createHetznerProvisioningMutationAttempt,
  createHetznerSingleNodeProvisioningIntent,
} from '../../src/core/runtime/providers/hetzner/single-node-provisioning.js';
import {
  HETZNER_SMALL_SERVER_TYPE_CANDIDATES,
  resolveHetznerSingleNodePlan,
} from '../../src/core/runtime/providers/hetzner/single-node-plan.js';
import { createSingleNodeDeploymentDesired } from '../../src/core/runtime/single-node-deployment-desired.js';
import { createSingleNodeDeploymentIncarnationId } from '../../src/core/runtime/single-node-deployment-identity.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../../src/core/runtime/single-node-deployment-intent.js';
import {
  SINGLE_NODE_CLOUD_INIT_CONTRACT_VERSION,
  SINGLE_NODE_DEPLOYMENT_ROOT,
} from '../../src/core/runtime/single-node-cloud-init.js';
import {
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
} from '../../src/core/runtime/single-node-remote-activation.js';

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
const SSH_FINGERPRINT = `SHA256:${Buffer.alloc(32, 17)
  .toString('base64')
  .replace(/=+$/u, '')}`;
const SSH_PUBLIC_FINGERPRINT = `SHA256:${Buffer.alloc(32, 19)
  .toString('base64')
  .replace(/=+$/u, '')}`;
/** @type {string[]} */
const temporaryRoots = [];

/** @type {Awaited<ReturnType<typeof makeAuthority>>} */
let authority;

beforeAll(async () => {
  authority = await makeAuthority();
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
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

async function makeAuthority() {
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
  const cloudInitBytes = Buffer.from('#cloud-config\n');
  const provisioningIntent = createHetznerSingleNodeProvisioningIntent({
    plan,
    incarnationId: createSingleNodeDeploymentIncarnationId(
      Buffer.alloc(32, 23),
    ),
    ownershipNonces: {
      firewall: sha256Base64Url('firewall-nonce'),
      primaryIp: sha256Base64Url('primary-ip-nonce'),
      server: sha256Base64Url('server-nonce'),
    },
    cloudInitDigest: digest(cloudInitBytes),
  });
  return Object.freeze({
    desired,
    providerIntent: Object.freeze({
      provider: 'hetzner',
      intent: provisioningIntent,
    }),
  });
}

async function makeStore() {
  const parent = await mkdtemp(join(tmpdir(), 'wharfie-single-node-journal-'));
  temporaryRoots.push(parent);
  await chmod(parent, 0o700);
  const dataRoot = join(parent, 'data');
  const store = createSingleNodeDeploymentJournalStore({
    appId: authority.desired.intent.appId,
    deploymentInstanceId: authority.desired.deploymentInstanceId,
    dataRoot,
  });
  return { parent, dataRoot, store };
}

/** @param {Readonly<Record<string, any>>} record @param {string} role @param {number} id @param {string|null} publicIpv4 */
function completeRole(record, role, id, publicIpv4 = null) {
  const prepared = prepareSingleNodeDeploymentMutation(
    record,
    createHetznerProvisioningMutationAttempt(
      authority.providerIntent.intent,
      role,
    ),
  );
  const attempt = getSingleNodeDeploymentMutationAttempt(prepared, role);
  if (attempt === null) throw new Error('test attempt was not prepared');
  const completed = completeSingleNodeDeploymentMutation(
    prepared,
    createHetznerProvisionedResourceRecord(
      authority.providerIntent.intent,
      role,
      id,
    ),
  );
  if (publicIpv4 === null) return completed;
  const resource = completed.resources.find(
    (/** @type {Record<string, any>} */ entry) => entry.role === role,
  );
  if (resource === undefined) throw new Error('test resource was not recorded');
  return recordSingleNodeDeploymentResource(completed, {
    ...resource,
    publicIpv4,
  });
}

/** @param {Readonly<Record<string, any>>} current @param {Readonly<Record<string, any>>} next */
function commitRequest(current, next) {
  return {
    expectedGeneration: current.generation,
    expectedJournalId: current.journalId,
    next,
  };
}

function createInitial() {
  return createSingleNodeDeploymentJournal(authority);
}

/** @param {string} role */
function providerAttempt(role) {
  return createHetznerProvisioningMutationAttempt(
    authority.providerIntent.intent,
    role,
  );
}

/** @param {string} role @param {number} id */
function providerResource(role, id) {
  return createHetznerProvisionedResourceRecord(
    authority.providerIntent.intent,
    role,
    id,
  );
}

/** @param {Readonly<Record<string, any>>} record @param {string} role */
function destroyAttempt(record, role) {
  const resource = record.resources.find(
    (/** @type {Record<string, any>} */ entry) => entry.role === role,
  );
  if (resource === undefined) {
    throw new Error(`test ${role} resource was not recorded`);
  }
  return createHetznerDestructionAttempt(
    authority.providerIntent.intent,
    role,
    resource.providerResourceId,
  );
}

/** @param {Readonly<Record<string, any>>} record @param {string} role */
function deletionRecord(record, role) {
  const resource = record.resources.find(
    (/** @type {Record<string, any>} */ entry) => entry.role === role,
  );
  if (resource === undefined) {
    throw new Error(`test ${role} resource was not recorded`);
  }
  const attempt =
    record.destroyAttempts.find(
      (/** @type {Record<string, any>} */ entry) => entry.role === role,
    ) ?? null;
  return createHetznerDeletionRecord(
    authority.providerIntent.intent,
    role,
    resource.providerResourceId,
    attempt,
  );
}

function remoteActivationEvidence() {
  const remotePath = `${SINGLE_NODE_DEPLOYMENT_ROOT}/${authority.desired.deploymentInstanceId}/artifacts/${authority.desired.artifact.artifactId}/app-sea`;
  const payload = sortCanonicalJsonValue({
    schemaVersion: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
    kind: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND,
    deploymentInstanceId: authority.desired.deploymentInstanceId,
    incarnationId: authority.providerIntent.intent.incarnationId,
    desiredRevisionId: authority.desired.desiredRevisionId,
    address: PUBLIC_IPV4,
    sshHostKey: {
      algorithm: 'ssh-ed25519',
      fingerprint: SSH_FINGERPRINT,
    },
    bootstrap: {
      contractVersion: SINGLE_NODE_CLOUD_INIT_CONTRACT_VERSION,
      sshPublicKeyFingerprint: SSH_PUBLIC_FINGERPRINT,
    },
    artifact: {
      artifactId: authority.desired.artifact.artifactId,
      revisionId: authority.desired.artifact.revisionId,
      byteDigest: authority.desired.artifact.byteDigest,
      size: authority.desired.artifact.size,
      remotePath,
    },
    service: {
      appId: authority.desired.intent.appId,
      unit: `wharfie-${authority.desired.intent.appId}.service`,
      health: 'healthy',
      activeArtifactId: authority.desired.artifact.artifactId,
      activeRevisionId: authority.desired.artifact.revisionId,
    },
  });
  return sortCanonicalJsonValue({
    ...payload,
    activationEvidenceId: createCanonicalJsonSha256Id({
      domain: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
      prefix: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
      value: payload,
      valuePath: 'testRemoteActivationEvidence',
    }),
  });
}

function createProvisioned() {
  let record = advanceSingleNodeDeploymentJournal(
    createInitial(),
    'provisioning',
  );
  record = completeRole(record, 'firewall', 11);
  record = completeRole(record, 'primaryIp', 12, PUBLIC_IPV4);
  record = completeRole(record, 'server', 13, PUBLIC_IPV4);
  return advanceSingleNodeDeploymentJournal(record, 'provisioned');
}

describe('single-node deployment journal contract', () => {
  it('seals credential-free immutable authority before the first mutation', () => {
    const journal = createInitial();

    expect(journal).toMatchObject({
      schemaVersion: 1,
      kind: 'singleNodeDeploymentJournal',
      journalId: expect.stringMatching(/^wsnj1_[A-Za-z0-9_-]{43}$/u),
      generation: 0,
      previousJournalId: null,
      deploymentInstanceId: authority.desired.deploymentInstanceId,
      incarnationId: authority.providerIntent.intent.incarnationId,
      phase: 'planned',
      mutationAttempts: [],
      resources: [],
      destroyAttempts: [],
      deletionRecords: [],
      sshHost: null,
      artifact: null,
      activation: null,
    });
    expect(Object.isFrozen(journal)).toBe(true);
    expect(Object.isFrozen(journal.providerIntent.intent)).toBe(true);
    expect(validateSingleNodeDeploymentJournal(clone(journal))).toEqual(
      journal,
    );
    expect(JSON.stringify(journal)).not.toMatch(
      /credential|authorization|private.key|access.token/iu,
    );
  });

  it('persists a deterministic mutation fence before accepting its outcome', () => {
    const provisioning = advanceSingleNodeDeploymentJournal(
      createInitial(),
      'provisioning',
    );
    const providerFence = providerAttempt('firewall');
    const prepared = prepareSingleNodeDeploymentMutation(
      provisioning,
      providerFence,
    );
    const attempt = getSingleNodeDeploymentMutationAttempt(
      prepared,
      'firewall',
    );
    if (attempt === null) throw new Error('test attempt was not prepared');

    expect(attempt).toEqual({
      provider: 'hetzner',
      role: 'firewall',
      operation: 'create',
      state: 'prepared',
      providerResourceId: null,
      evidence: {
        ...providerFence,
        attemptId: expect.stringMatching(/^wshma1_[A-Za-z0-9_-]{43}$/u),
      },
    });
    expect(
      prepareSingleNodeDeploymentMutation(prepared, providerFence),
    ).toEqual(prepared);
    expect(() =>
      completeSingleNodeDeploymentMutation(
        provisioning,
        providerResource('firewall', 11),
      ),
    ).toThrow(/not durably prepared/iu);
    expect(() =>
      advanceSingleNodeDeploymentJournal(
        advanceSingleNodeDeploymentJournal(prepared, 'destroying'),
        'destroyed',
      ),
    ).toThrow(/mutation to be resolved/iu);

    const completed = completeSingleNodeDeploymentMutation(
      prepared,
      providerResource('firewall', 11),
    );
    expect(
      getSingleNodeDeploymentMutationAttempt(completed, 'firewall'),
    ).toEqual({
      ...attempt,
      state: 'succeeded',
      providerResourceId: 11,
    });
    expect(completed.resources).toEqual([
      {
        provider: 'hetzner',
        role: 'firewall',
        providerResourceId: 11,
        publicIpv4: null,
        state: 'present',
      },
    ]);
    expect(getSingleNodeDeploymentProvisioningRecoveryState(completed)).toEqual(
      {
        storedResourceIds: {
          firewall: 11,
          primaryIp: null,
          server: null,
        },
        storedMutationAttempts: {
          firewall: providerFence,
          primaryIp: null,
          server: null,
        },
      },
    );
    expect(
      completeSingleNodeDeploymentMutation(
        completed,
        providerResource('firewall', 11),
      ),
    ).toEqual(completed);
    expect(() =>
      completeSingleNodeDeploymentMutation(
        completed,
        providerResource('firewall', 99),
      ),
    ).toThrow(/immutable/iu);
  });

  it('rejects resource identity, address, and lifecycle regression', () => {
    const provisioned = createProvisioned();
    const primaryIp = provisioned.resources.find(
      (/** @type {Record<string, any>} */ resource) =>
        resource.role === 'primaryIp',
    );
    if (primaryIp === undefined) throw new Error('test primary IP is missing');

    expect(() =>
      recordSingleNodeDeploymentResource(
        advanceSingleNodeDeploymentJournal(provisioned, 'destroying'),
        { ...primaryIp, providerResourceId: 999 },
      ),
    ).toThrow(/not monotonic/iu);
    expect(() =>
      recordSingleNodeDeploymentResource(
        advanceSingleNodeDeploymentJournal(provisioned, 'destroying'),
        { ...primaryIp, publicIpv4: '192.0.2.99' },
      ),
    ).toThrow(/not monotonic/iu);
    expect(() =>
      recordSingleNodeDeploymentResource(
        advanceSingleNodeDeploymentJournal(provisioned, 'destroying'),
        { ...primaryIp, state: 'absent' },
      ),
    ).toThrow(/deletion record/iu);
    expect(() =>
      advanceSingleNodeDeploymentJournal(provisioned, 'provisioning'),
    ).toThrow(/cannot advance/iu);
  });

  it('records pinned host, exact artifact, and durable activation monotonically', () => {
    let record = createProvisioned();
    record = recordSingleNodeDeploymentSshHost(record, {
      address: PUBLIC_IPV4,
      algorithm: 'ssh-ed25519',
      fingerprint: SSH_FINGERPRINT,
    });
    record = advanceSingleNodeDeploymentJournal(record, 'activating');
    const evidence = remoteActivationEvidence();
    record = recordSingleNodeDeploymentActivation(record, evidence);
    record = advanceSingleNodeDeploymentJournal(record, 'active');

    expect(record.phase).toBe('active');
    expect(record.sshHost.address).toBe(PUBLIC_IPV4);
    expect(record.artifact.artifactId).toBe(
      authority.desired.artifact.artifactId,
    );
    expect(record.activation).toEqual(evidence);
    expect(record.activation.activationEvidenceId).toMatch(
      /^wsne1_[A-Za-z0-9_-]{43}$/u,
    );
    expect(record.artifact.remotePath).toBe(evidence.artifact.remotePath);
    expect(() =>
      recordSingleNodeDeploymentActivation(
        advanceSingleNodeDeploymentJournal(
          recordSingleNodeDeploymentSshHost(createProvisioned(), {
            address: PUBLIC_IPV4,
            algorithm: 'ssh-ed25519',
            fingerprint: SSH_FINGERPRINT,
          }),
          'activating',
        ),
        {
          desiredRevisionId: authority.desired.desiredRevisionId,
          artifactId: authority.desired.artifact.artifactId,
          serviceStatus: 'active',
        },
      ),
    ).toThrow();
    expect(() =>
      recordSingleNodeDeploymentSshHost(
        advanceSingleNodeDeploymentJournal(createProvisioned(), 'activating'),
        {
          address: '192.0.2.99',
          algorithm: 'ssh-ed25519',
          fingerprint: SSH_FINGERPRINT,
        },
      ),
    ).toThrow(/provider-observed address/iu);
  });

  it('retains exact ordered destruction fences and deletion proof', () => {
    let record = advanceSingleNodeDeploymentJournal(
      createProvisioned(),
      'destroying',
    );
    expect(() =>
      prepareSingleNodeDeploymentDestruction(
        record,
        destroyAttempt(record, 'primaryIp'),
      ),
    ).toThrow(/server to be absent first/iu);
    expect(() =>
      recordSingleNodeDeploymentDeletion(
        record,
        deletionRecord(record, 'primaryIp'),
      ),
    ).toThrow(/server to be absent first/iu);

    const serverAttempt = destroyAttempt(record, 'server');
    record = prepareSingleNodeDeploymentDestruction(record, serverAttempt);
    expect(
      prepareSingleNodeDeploymentDestruction(record, serverAttempt),
    ).toEqual(record);
    expect(record.destroyAttempts[0]).toEqual({
      ...serverAttempt,
      attemptId: expect.stringMatching(/^wshda1_[A-Za-z0-9_-]{43}$/u),
    });
    expect(() =>
      prepareSingleNodeDeploymentDestruction(
        record,
        createHetznerDestructionAttempt(
          authority.providerIntent.intent,
          'server',
          999,
        ),
      ),
    ).toThrow(/conflicts/iu);

    const serverDeletion = deletionRecord(record, 'server');
    record = recordSingleNodeDeploymentDeletion(record, serverDeletion);
    expect(recordSingleNodeDeploymentDeletion(record, serverDeletion)).toEqual(
      record,
    );
    expect(record.deletionRecords[0]).toEqual({
      ...serverDeletion,
      deletionId: expect.stringMatching(/^wshdd1_[A-Za-z0-9_-]{43}$/u),
      destroyAttemptId: serverAttempt.attemptId,
    });
    expect(
      record.resources.find(
        (/** @type {Record<string, any>} */ resource) =>
          resource.role === 'server',
      )?.state,
    ).toBe('absent');
    expect(() =>
      recordSingleNodeDeploymentDeletion(
        record,
        createHetznerDeletionRecord(
          authority.providerIntent.intent,
          'server',
          13,
          null,
        ),
      ),
    ).toThrow(/destroy authority/iu);

    record = prepareSingleNodeDeploymentDestruction(
      record,
      destroyAttempt(record, 'primaryIp'),
    );
    record = recordSingleNodeDeploymentDeletion(
      record,
      deletionRecord(record, 'primaryIp'),
    );
    record = prepareSingleNodeDeploymentDestruction(
      record,
      destroyAttempt(record, 'firewall'),
    );
    record = recordSingleNodeDeploymentDeletion(
      record,
      deletionRecord(record, 'firewall'),
    );

    expect(getSingleNodeDeploymentDestructionRecoveryState(record)).toEqual({
      storedResourceIds: {
        server: 13,
        primaryIp: 12,
        firewall: 11,
      },
      storedDestroyAttempts: {
        server: record.destroyAttempts.find(
          (/** @type {Record<string, any>} */ entry) => entry.role === 'server',
        ),
        primaryIp: record.destroyAttempts.find(
          (/** @type {Record<string, any>} */ entry) =>
            entry.role === 'primaryIp',
        ),
        firewall: record.destroyAttempts.find(
          (/** @type {Record<string, any>} */ entry) =>
            entry.role === 'firewall',
        ),
      },
      storedDeletionRecords: {
        server: record.deletionRecords.find(
          (/** @type {Record<string, any>} */ entry) => entry.role === 'server',
        ),
        primaryIp: record.deletionRecords.find(
          (/** @type {Record<string, any>} */ entry) =>
            entry.role === 'primaryIp',
        ),
        firewall: record.deletionRecords.find(
          (/** @type {Record<string, any>} */ entry) =>
            entry.role === 'firewall',
        ),
      },
    });
    record = advanceSingleNodeDeploymentJournal(record, 'destroyed');
    expect(record.phase).toBe('destroyed');
  });

  it('treats never-created roles as absent during partial destruction', () => {
    let record = advanceSingleNodeDeploymentJournal(
      createInitial(),
      'provisioning',
    );
    record = completeRole(record, 'firewall', 11);
    record = completeRole(record, 'primaryIp', 12, PUBLIC_IPV4);
    record = advanceSingleNodeDeploymentJournal(record, 'destroying');
    const primaryDeletion = deletionRecord(record, 'primaryIp');
    expect(primaryDeletion.destroyAttemptId).toBeNull();
    record = recordSingleNodeDeploymentDeletion(record, primaryDeletion);
    expect(() =>
      recordSingleNodeDeploymentDeletion(
        record,
        deletionRecord(record, 'firewall'),
      ),
    ).not.toThrow();
    record = recordSingleNodeDeploymentDeletion(
      record,
      deletionRecord(record, 'firewall'),
    );
    record = advanceSingleNodeDeploymentJournal(record, 'destroyed');

    expect(record.phase).toBe('destroyed');
    expect(
      record.resources.every(
        (/** @type {Record<string, any>} */ resource) =>
          resource.state === 'absent',
      ),
    ).toBe(true);
    expect(
      getSingleNodeDeploymentDestructionRecoveryState(record),
    ).toMatchObject({
      storedResourceIds: {
        server: null,
        primaryIp: 12,
        firewall: 11,
      },
      storedDestroyAttempts: {
        server: null,
        primaryIp: null,
        firewall: null,
      },
    });
    expect(() =>
      recordSingleNodeDeploymentResource(record, {
        provider: 'hetzner',
        role: 'server',
        providerResourceId: 13,
        publicIpv4: PUBLIC_IPV4,
        state: 'present',
      }),
    ).toThrow(/this phase/iu);
  });

  it('rejects tampering, secret-like fields, and non-successor snapshots', () => {
    const initial = createInitial();
    const tampered = /** @type {any} */ (clone(initial));
    tampered.phase = 'active';
    expect(() => validateSingleNodeDeploymentJournal(tampered)).toThrow();

    const credentialBearing = /** @type {any} */ (clone(authority));
    credentialBearing.providerIntent.intent.credentials =
      'hcloud-secret-sentinel';
    expect(() =>
      createSingleNodeDeploymentJournal(credentialBearing),
    ).toThrow();

    const provisioning = advanceSingleNodeDeploymentJournal(
      initial,
      'provisioning',
    );
    const skipped = completeRole(provisioning, 'firewall', 11);
    expect(() =>
      validateSingleNodeDeploymentJournalSuccessor(initial, skipped),
    ).toThrow(/generation|successor/iu);
  });
});

describe('single-node deployment journal persistence', () => {
  it('prepares private storage without publishing deployment authority', async () => {
    const { store } = await makeStore();

    await store.prepareStorage();
    await store.prepareStorage();

    expect(await store.read()).toBeNull();
    expect(await readdir(store.paths.journalRoot)).toEqual([]);
    for (const directory of store.paths.directories) {
      const stats = await lstat(directory);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.mode & 0o777).toBe(0o700);
    }
  });

  it('accepts a non-writable 0755 shared root while keeping journal-owned paths private', async () => {
    const { store, dataRoot } = await makeStore();
    await mkdir(dataRoot, { mode: 0o755 });

    await store.prepareStorage();

    expect((await lstat(dataRoot)).mode & 0o777).toBe(0o755);
    for (const directory of store.paths.privateDirectories) {
      expect((await lstat(directory)).mode & 0o777).toBe(0o700);
    }
    expect(await readdir(store.paths.journalRoot)).toEqual([]);
    expect(await store.initialize(authority)).toMatchObject({
      generation: 0,
      phase: 'planned',
    });
  });

  it('uses stable app storage, exact private modes, canonical generations, and durable readback', async () => {
    const { store } = await makeStore();
    const initial = await store.initialize(authority);
    const provisioning = advanceSingleNodeDeploymentJournal(
      initial,
      'provisioning',
    );
    const committed = await store.commit(commitRequest(initial, provisioning));

    expect(await store.read()).toEqual(committed);
    expect(await readdir(store.paths.journalRoot)).toEqual([
      'journal-0000000000000000.json',
      'journal-0000000000000001.json',
    ]);
    expect((await lstat(store.paths.dataRoot)).mode & 0o777).toBe(0o700);
    expect((await lstat(store.paths.deploymentRoot)).mode & 0o777).toBe(0o700);
    expect(
      (
        await lstat(
          join(store.paths.journalRoot, 'journal-0000000000000000.json'),
        )
      ).mode & 0o777,
    ).toBe(0o600);
    const encoded = await readFile(
      join(store.paths.journalRoot, 'journal-0000000000000001.json'),
      'utf8',
    );
    expect(encoded.endsWith('\n')).toBe(true);
    expect(JSON.parse(encoded)).toEqual(committed);
    expect(await store.initialize(authority)).toEqual(committed);
  });

  it('retains an unresolved pre-POST fence across restart', async () => {
    const { store, dataRoot } = await makeStore();
    const initial = await store.initialize(authority);
    const provisioning = await store.commit(
      commitRequest(
        initial,
        advanceSingleNodeDeploymentJournal(initial, 'provisioning'),
      ),
    );
    const prepared = await store.commit(
      commitRequest(
        provisioning,
        prepareSingleNodeDeploymentMutation(
          provisioning,
          providerAttempt('primaryIp'),
        ),
      ),
    );
    const reopened = createSingleNodeDeploymentJournalStore({
      appId: authority.desired.intent.appId,
      deploymentInstanceId: authority.desired.deploymentInstanceId,
      dataRoot,
    });
    const recovered = await reopened.read();

    expect(recovered).toEqual(prepared);
    expect(
      getSingleNodeDeploymentMutationAttempt(recovered, 'primaryIp'),
    ).toMatchObject({
      state: 'prepared',
      providerResourceId: null,
    });
    expect(
      prepareSingleNodeDeploymentMutation(
        recovered,
        providerAttempt('primaryIp'),
      ),
    ).toEqual(recovered);
  });

  it('serializes and replays atomic destruction evidence across restart', async () => {
    const { store, dataRoot } = await makeStore();
    let record = await store.initialize(authority);
    let next = advanceSingleNodeDeploymentJournal(record, 'provisioning');
    record = await store.commit(commitRequest(record, next));
    next = prepareSingleNodeDeploymentMutation(
      record,
      providerAttempt('server'),
    );
    record = await store.commit(commitRequest(record, next));
    next = completeSingleNodeDeploymentMutation(
      record,
      providerResource('server', 13),
    );
    record = await store.commit(commitRequest(record, next));
    next = advanceSingleNodeDeploymentJournal(record, 'destroying');
    record = await store.commit(commitRequest(record, next));
    next = prepareSingleNodeDeploymentDestruction(
      record,
      destroyAttempt(record, 'server'),
    );
    record = await store.commit(commitRequest(record, next));
    next = recordSingleNodeDeploymentDeletion(
      record,
      deletionRecord(record, 'server'),
    );
    record = await store.commit(commitRequest(record, next));

    const reopened = createSingleNodeDeploymentJournalStore({
      appId: authority.desired.intent.appId,
      deploymentInstanceId: authority.desired.deploymentInstanceId,
      dataRoot,
    });
    const recovered = await reopened.read();

    expect(recovered).toEqual(record);
    expect(getSingleNodeDeploymentDestructionRecoveryState(recovered)).toEqual({
      storedResourceIds: {
        server: 13,
        primaryIp: null,
        firewall: null,
      },
      storedDestroyAttempts: {
        server: recovered.destroyAttempts[0],
        primaryIp: null,
        firewall: null,
      },
      storedDeletionRecords: {
        server: recovered.deletionRecords[0],
        primaryIp: null,
        firewall: null,
      },
    });
    expect(recovered.resources).toEqual([
      {
        provider: 'hetzner',
        role: 'server',
        providerResourceId: 13,
        publicIpv4: null,
        state: 'absent',
      },
    ]);
  });

  it('allows exactly one competing writer to claim a generation', async () => {
    const { store } = await makeStore();
    const initial = await store.initialize(authority);
    const provisioning = await store.commit(
      commitRequest(
        initial,
        advanceSingleNodeDeploymentJournal(initial, 'provisioning'),
      ),
    );
    const firewall = prepareSingleNodeDeploymentMutation(
      provisioning,
      providerAttempt('firewall'),
    );
    const primaryIp = prepareSingleNodeDeploymentMutation(
      provisioning,
      providerAttempt('primaryIp'),
    );
    const results = await Promise.allSettled([
      store.commit(commitRequest(provisioning, firewall)),
      store.commit(commitRequest(provisioning, primaryIp)),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection?.reason).toBeInstanceOf(
      SingleNodeDeploymentJournalConflictError,
    );
    expect((await store.read()).generation).toBe(provisioning.generation + 1);
  });

  it('rejects stale CAS without writing and safely reaps an interrupted temporary link', async () => {
    const { store } = await makeStore();
    const initial = await store.initialize(authority);
    const provisioning = await store.commit(
      commitRequest(
        initial,
        advanceSingleNodeDeploymentJournal(initial, 'provisioning'),
      ),
    );
    await expect(
      store.commit(
        commitRequest(
          initial,
          advanceSingleNodeDeploymentJournal(initial, 'destroying'),
        ),
      ),
    ).rejects.toBeInstanceOf(SingleNodeDeploymentJournalConflictError);

    const generationPath = join(
      store.paths.journalRoot,
      'journal-0000000000000001.json',
    );
    const interruptedPath = join(
      store.paths.journalRoot,
      '.journal-0000000000000002-00000000-0000-4000-8000-000000000000.tmp',
    );
    await link(generationPath, interruptedPath);
    const prepared = prepareSingleNodeDeploymentMutation(
      provisioning,
      providerAttempt('server'),
    );
    await store.commit(commitRequest(provisioning, prepared));

    expect(await readdir(store.paths.journalRoot)).not.toContain(
      '.journal-0000000000000002-00000000-0000-4000-8000-000000000000.tmp',
    );
    expect((await lstat(generationPath)).nlink).toBe(1);
  });

  it('fails closed for unsafe directories, symlinks, and unknown entries', async () => {
    const first = await makeStore();
    await mkdir(first.dataRoot, { mode: 0o755 });
    await chmod(first.dataRoot, 0o770);
    await expect(first.store.initialize(authority)).rejects.toBeInstanceOf(
      SingleNodeDeploymentJournalInvalidError,
    );

    const second = await makeStore();
    await mkdir(second.dataRoot, { mode: 0o700 });
    const applicationsPath = join(second.dataRoot, 'applications');
    await symlink(second.parent, applicationsPath);
    await expect(second.store.initialize(authority)).rejects.toBeInstanceOf(
      SingleNodeDeploymentJournalInvalidError,
    );

    const third = await makeStore();
    await third.store.initialize(authority);
    await writeFile(
      join(third.store.paths.journalRoot, 'unexpected'),
      'not journal state',
      { mode: 0o600 },
    );
    await expect(third.store.read()).rejects.toBeInstanceOf(
      SingleNodeDeploymentJournalInvalidError,
    );
  });

  it('fails closed for a noncanonical or corrupted generation', async () => {
    const { store } = await makeStore();
    await store.initialize(authority);
    const recordPath = join(
      store.paths.journalRoot,
      'journal-0000000000000000.json',
    );
    const original = await readFile(recordPath, 'utf8');
    await writeFile(recordPath, ` ${original}`, { mode: 0o600 });

    await expect(store.read()).rejects.toBeInstanceOf(
      SingleNodeDeploymentJournalInvalidError,
    );
  });

  it('rejects a generation hard-linked outside its authenticated temp namespace', async () => {
    const { store, parent } = await makeStore();
    await store.initialize(authority);
    await link(
      join(store.paths.journalRoot, 'journal-0000000000000000.json'),
      join(parent, 'external-journal-link'),
    );

    await expect(store.read()).rejects.toBeInstanceOf(
      SingleNodeDeploymentJournalInvalidError,
    );
  });
});
