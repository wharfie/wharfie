import { createHash } from 'node:crypto';

import { createApplicationRevision } from '../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../src/core/runtime/artifact-record.js';
import { sortCanonicalJsonValue } from '../../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../../src/core/runtime/content-id.js';
import {
  createHetznerProvisionedResourceRecord,
  createHetznerProvisioningMutationAttempt,
  createHetznerSingleNodeProvisioningIntent,
} from '../../../src/core/runtime/providers/hetzner/single-node-provisioning.js';
import {
  HETZNER_SMALL_SERVER_TYPE_CANDIDATES,
  resolveHetznerSingleNodePlan,
} from '../../../src/core/runtime/providers/hetzner/single-node-plan.js';
import {
  advanceSingleNodeDeploymentJournal,
  completeSingleNodeDeploymentMutation,
  createSingleNodeDeploymentJournal,
  prepareSingleNodeDeploymentMutation,
  recordSingleNodeDeploymentActivation,
  recordSingleNodeDeploymentResource,
  recordSingleNodeDeploymentSshHost,
  settleSingleNodeDeploymentReleaseTransition,
} from '../../../src/core/runtime/single-node-deployment-journal.js';
import { createSingleNodeDeploymentDesired } from '../../../src/core/runtime/single-node-deployment-desired.js';
import { createSingleNodeDeploymentIncarnationId } from '../../../src/core/runtime/single-node-deployment-identity.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../../../src/core/runtime/single-node-deployment-intent.js';
import {
  SINGLE_NODE_CLOUD_INIT_CONTRACT_VERSION,
  SINGLE_NODE_DEPLOYMENT_ROOT,
  createSingleNodeCloudInit,
} from '../../../src/core/runtime/single-node-cloud-init.js';
import {
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
} from '../../../src/core/runtime/single-node-remote-activation.js';

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
const RESOURCE_IDS = Object.freeze({
  firewall: 101,
  primaryIp: 102,
  server: 103,
});

/** @param {string|Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string|Buffer} value */
function wireString(value) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.byteLength);
  return Buffer.concat([length, bytes]);
}

function publicKey() {
  const blob = Buffer.concat([
    wireString('ssh-ed25519'),
    wireString(Buffer.alloc(32, 7)),
  ]);
  return `ssh-ed25519 ${blob.toString('base64')}`;
}

/** @param {string} key */
function publicKeyFingerprint(key) {
  return `SHA256:${createHash('sha256')
    .update(Buffer.from(key.split(' ')[1], 'base64'))
    .digest('base64')
    .replace(/=+$/u, '')}`;
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

/**
 * Build one valid desired state, provider intent, and matching SSH/bootstrap
 * identity for read-only deployment-status tests.
 */
export async function createSingleNodeStatusAuthorityFixture() {
  const revision = createApplicationRevision({
    contract: {
      schemaVersion: 4,
      app: { id: 'status-app' },
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
  const artifactRecord = createArtifactRecord({
    bytes: Buffer.from('status Linux SEA payload'),
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
    appId: 'status-app',
    target: TARGET,
    mode: SINGLE_NODE_DEPLOYMENT_MODE,
    machine: SINGLE_NODE_MACHINE,
    access: {
      kind: 'public-ssh',
      allowedIpv4: ['203.0.113.7/32'],
    },
    provider: { kind: 'hetzner', location: LOCATION.name },
  });
  const desired = createSingleNodeDeploymentDesired({
    intent,
    revision,
    artifactRecord,
    observation: {
      artifactId: artifactRecord.artifactId,
      byteDigest: artifactRecord.byteDigest,
      size: artifactRecord.size,
    },
  });
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
  const incarnationId = createSingleNodeDeploymentIncarnationId(
    Buffer.alloc(32, 37),
  );
  const key = publicKey();
  const sshPublicKeyFingerprint = publicKeyFingerprint(key);
  const bootstrap = createSingleNodeCloudInit({
    deploymentInstanceId: desired.deploymentInstanceId,
    incarnationId,
    publicKey: key,
    publicKeyFingerprint: sshPublicKeyFingerprint,
  });
  const providerIntent = createHetznerSingleNodeProvisioningIntent({
    plan,
    incarnationId,
    ownershipNonces: {
      firewall: sha256Base64Url('firewall-nonce'),
      primaryIp: sha256Base64Url('primary-ip-nonce'),
      server: sha256Base64Url('server-nonce'),
    },
    cloudInitDigest: bootstrap.digest,
  });
  const publicIpv4 = '192.0.2.44';
  const hostKeyFingerprint = `SHA256:${Buffer.alloc(32, 17)
    .toString('base64')
    .replace(/=+$/u, '')}`;

  return Object.freeze({
    revision,
    artifactRecord,
    desired,
    providerIntent: Object.freeze({
      provider: 'hetzner',
      intent: providerIntent,
    }),
    incarnationId,
    publicIpv4,
    hostKeyFingerprint,
    bootstrapIdentity: bootstrap.bootstrapIdentity,
    sshIdentity: Object.freeze({
      privateKeyPath: '/private/status/id_ed25519',
      publicKey: key,
      publicKeyFingerprint: sshPublicKeyFingerprint,
      knownHostsPath: '/private/status/known_hosts',
    }),
  });
}

/**
 * Build a compatible release-only target for update and recovery tests.
 * @param {Readonly<Record<string, any>>} fixture
 * @param {string} label
 */
export function createSingleNodeStatusUpdateTarget(fixture, label) {
  const revision = createApplicationRevision({
    contract: fixture.revision.contract,
    inputs: {
      ...fixture.revision.inputs,
      source: {
        format: 'wharfie-source-tree-v1',
        digest: digest(`source-${label}`),
      },
    },
  });
  const bytes = Buffer.from(`updated Linux SEA payload ${label}`);
  const artifactRecord = createArtifactRecord({
    bytes,
    revision,
    target: fixture.artifactRecord.target,
    provenance: {
      ...fixture.artifactRecord.provenance,
      builder: {
        ...fixture.artifactRecord.provenance.builder,
        runtimeDigest: revision.inputs.runtime.digest,
      },
    },
  });
  const observation = Object.freeze({
    artifactId: artifactRecord.artifactId,
    byteDigest: artifactRecord.byteDigest,
    size: artifactRecord.size,
  });
  return Object.freeze({
    revision,
    artifactRecord,
    observation,
    desired: createSingleNodeDeploymentDesired({
      intent: fixture.desired.intent,
      revision,
      artifactRecord,
      observation,
    }),
  });
}

/** @param {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} fixture */
export function createSingleNodeStatusInitialJournal(fixture) {
  return createSingleNodeDeploymentJournal({
    desired: fixture.desired,
    providerIntent: fixture.providerIntent,
  });
}

/** @param {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} fixture */
function createProvisionedJournal(fixture) {
  let journal = advanceSingleNodeDeploymentJournal(
    createSingleNodeStatusInitialJournal(fixture),
    'provisioning',
  );
  for (const role of ['firewall', 'primaryIp', 'server']) {
    journal = prepareSingleNodeDeploymentMutation(
      journal,
      createHetznerProvisioningMutationAttempt(
        fixture.providerIntent.intent,
        role,
      ),
    );
    journal = completeSingleNodeDeploymentMutation(
      journal,
      createHetznerProvisionedResourceRecord(
        fixture.providerIntent.intent,
        role,
        RESOURCE_IDS[/** @type {keyof typeof RESOURCE_IDS} */ (role)],
      ),
    );
    if (role !== 'firewall') {
      const resource = journal.resources.find(
        (/** @type {Record<string, any>} */ entry) => entry.role === role,
      );
      journal = recordSingleNodeDeploymentResource(journal, {
        ...resource,
        publicIpv4: fixture.publicIpv4,
      });
    }
  }
  return advanceSingleNodeDeploymentJournal(journal, 'provisioned');
}

/** @param {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} fixture */
function activationEvidence(fixture) {
  const desired = fixture.desired;
  const remotePath = `${SINGLE_NODE_DEPLOYMENT_ROOT}/${desired.deploymentInstanceId}/artifacts/${desired.artifact.artifactId}/app-sea`;
  const payload = sortCanonicalJsonValue({
    schemaVersion: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
    kind: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND,
    deploymentInstanceId: desired.deploymentInstanceId,
    incarnationId: fixture.incarnationId,
    desiredRevisionId: desired.desiredRevisionId,
    address: fixture.publicIpv4,
    sshHostKey: {
      algorithm: 'ssh-ed25519',
      fingerprint: fixture.hostKeyFingerprint,
    },
    bootstrap: {
      contractVersion: SINGLE_NODE_CLOUD_INIT_CONTRACT_VERSION,
      sshPublicKeyFingerprint: fixture.sshIdentity.publicKeyFingerprint,
    },
    artifact: {
      artifactId: desired.artifact.artifactId,
      revisionId: desired.artifact.revisionId,
      byteDigest: desired.artifact.byteDigest,
      size: desired.artifact.size,
      remotePath,
    },
    service: {
      appId: desired.intent.appId,
      unit: `wharfie-${desired.intent.appId}.service`,
      health: 'healthy',
      activeArtifactId: desired.artifact.artifactId,
      activeRevisionId: desired.artifact.revisionId,
    },
  });
  return sortCanonicalJsonValue({
    ...payload,
    activationEvidenceId: createCanonicalJsonSha256Id({
      domain: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
      prefix: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
      value: payload,
      valuePath: 'singleNodeStatusFixture.activationEvidence',
    }),
  });
}

/** @param {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} fixture */
export function createSingleNodeStatusActivatingJournal(fixture) {
  const journal = recordSingleNodeDeploymentSshHost(
    createProvisionedJournal(fixture),
    {
      address: fixture.publicIpv4,
      algorithm: 'ssh-ed25519',
      fingerprint: fixture.hostKeyFingerprint,
    },
  );
  return advanceSingleNodeDeploymentJournal(journal, 'activating');
}

/** @param {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} fixture */
export function createSingleNodeStatusActiveJournal(fixture) {
  let journal = createSingleNodeStatusActivatingJournal(fixture);
  journal = recordSingleNodeDeploymentActivation(
    journal,
    activationEvidence(fixture),
  );
  journal = settleSingleNodeDeploymentReleaseTransition(journal);
  return advanceSingleNodeDeploymentJournal(journal, 'active');
}

/** @param {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} fixture */
export function createSingleNodeStatusDestroyedJournal(fixture) {
  const destroying = advanceSingleNodeDeploymentJournal(
    createSingleNodeStatusInitialJournal(fixture),
    'destroying',
  );
  return advanceSingleNodeDeploymentJournal(destroying, 'destroyed');
}

/**
 * @param {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} fixture
 * @param {Record<string, any>} [overrides]
 */
export function createHealthySingleNodeServiceStatus(fixture, overrides = {}) {
  const release = {
    artifactId: fixture.desired.artifact.artifactId,
    revisionId: fixture.desired.artifact.revisionId,
  };
  const unit = `wharfie-${fixture.desired.intent.appId}.service`;
  return {
    schemaVersion: 3,
    kind: 'wharfie.service.status',
    appId: fixture.desired.intent.appId,
    unit,
    health: 'healthy',
    wiring: {
      state: 'managed',
      unitFile: 'managed',
      selection: 'managed',
      effectiveUnit: 'managed',
      cleanupPending: false,
    },
    installation: {
      state: 'installed',
      activeArtifactId: release.artifactId,
      activeRevisionId: release.revisionId,
    },
    systemd: {
      loadState: 'loaded',
      unitFileState: 'enabled',
      activeState: 'active',
      subState: 'running',
      result: 'success',
    },
    runtime: {
      status: 'READY',
      session: 'active',
      currentOwner: true,
      ...release,
    },
    activation: {
      phase: 'ACTIVE',
      desired: release,
      selected: release,
    },
    integrity: { status: 'verified', ...release },
    persistence: {
      linger: true,
      unitEnabled: true,
      bootEnabled: true,
    },
    desiredConvergence: {
      schemaVersion: 1,
      kind: 'wharfie.service.desired-convergence',
      appId: fixture.desired.intent.appId,
      unit,
      desired: release,
      disposition: 'authorized',
      basis: 'durable-active',
    },
    ...overrides,
  };
}

/**
 * @param {{exitCode?: number, stdout?: string|Buffer, stderr?: string|Buffer}} [value]
 */
export function createProcessOutcome({
  exitCode = 0,
  stdout = Buffer.alloc(0),
  stderr = Buffer.alloc(0),
} = {}) {
  return {
    status: /** @type {const} */ ('exited'),
    exitCode,
    signal: null,
    timedOut: false,
    stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
    stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr),
  };
}
