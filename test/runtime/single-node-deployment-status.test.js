import { beforeAll, describe, expect, it } from '@jest/globals';

import { createApplicationRevision } from '../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../src/core/runtime/artifact-record.js';
import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import { createHetznerDeletionRecord } from '../../src/core/runtime/providers/hetzner/single-node-destruction.js';
import {
  createHetznerProvisionedResourceRecord,
  createHetznerProvisioningMutationAttempt,
  createHetznerSingleNodeProvisioningIntent,
} from '../../src/core/runtime/providers/hetzner/single-node-provisioning.js';
import {
  HETZNER_SMALL_SERVER_TYPE_CANDIDATES,
  resolveHetznerSingleNodePlan,
} from '../../src/core/runtime/providers/hetzner/single-node-plan.js';
import {
  advanceSingleNodeDeploymentJournal,
  completeSingleNodeDeploymentMutation,
  createSingleNodeDeploymentJournal,
  prepareSingleNodeDeploymentMutation,
  recordSingleNodeDeploymentActivation,
  recordSingleNodeDeploymentDeletion,
  recordSingleNodeDeploymentResource,
  recordSingleNodeDeploymentSshHost,
} from '../../src/core/runtime/single-node-deployment-journal.js';
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
import {
  SINGLE_NODE_DEPLOYMENT_STATUS_KIND,
  createSingleNodeDeploymentStatus,
  validateSingleNodeDeploymentStatus,
} from '../../src/core/runtime/single-node-deployment-status.js';

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
const IDS = Object.freeze({ firewall: 101, primaryIp: 102, server: 103 });
const PUBLIC_IPV4 = '192.0.2.44';
const SSH_FINGERPRINT = `SHA256:${Buffer.alloc(32, 17)
  .toString('base64')
  .replace(/=+$/u, '')}`;
const SSH_PUBLIC_FINGERPRINT = `SHA256:${Buffer.alloc(32, 19)
  .toString('base64')
  .replace(/=+$/u, '')}`;

/** @type {Readonly<Record<string, any>>} */
let authority;

beforeAll(async () => {
  authority = await makeAuthority();
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

async function makeAuthority() {
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
  return Object.freeze({
    desired,
    providerIntent: Object.freeze({
      provider: 'hetzner',
      intent: providerIntent,
    }),
  });
}

function makeInitialJournal() {
  return createSingleNodeDeploymentJournal(authority);
}

function makeProvisionedJournal() {
  let journal = advanceSingleNodeDeploymentJournal(
    makeInitialJournal(),
    'provisioning',
  );
  for (const role of ['firewall', 'primaryIp', 'server']) {
    journal = prepareSingleNodeDeploymentMutation(
      journal,
      createHetznerProvisioningMutationAttempt(
        authority.providerIntent.intent,
        role,
      ),
    );
    journal = completeSingleNodeDeploymentMutation(
      journal,
      createHetznerProvisionedResourceRecord(
        authority.providerIntent.intent,
        role,
        IDS[/** @type {keyof typeof IDS} */ (role)],
      ),
    );
    if (role !== 'firewall') {
      const resource = journal.resources.find(
        (/** @type {Readonly<Record<string, any>>} */ entry) =>
          entry.role === role,
      );
      journal = recordSingleNodeDeploymentResource(journal, {
        ...resource,
        publicIpv4: PUBLIC_IPV4,
      });
    }
  }
  return advanceSingleNodeDeploymentJournal(journal, 'provisioned');
}

function remoteActivationEvidence() {
  const desired = authority.desired;
  const remotePath = `${SINGLE_NODE_DEPLOYMENT_ROOT}/${desired.deploymentInstanceId}/artifacts/${desired.artifact.artifactId}/app-sea`;
  const payload = sortCanonicalJsonValue({
    schemaVersion: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_SCHEMA_VERSION,
    kind: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_KIND,
    deploymentInstanceId: desired.deploymentInstanceId,
    incarnationId: authority.providerIntent.intent.incarnationId,
    desiredRevisionId: desired.desiredRevisionId,
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
      valuePath: 'testRemoteActivationEvidence',
    }),
  });
}

function makeActiveJournal() {
  let journal = recordSingleNodeDeploymentSshHost(makeProvisionedJournal(), {
    address: PUBLIC_IPV4,
    algorithm: 'ssh-ed25519',
    fingerprint: SSH_FINGERPRINT,
  });
  journal = advanceSingleNodeDeploymentJournal(journal, 'activating');
  journal = recordSingleNodeDeploymentActivation(
    journal,
    remoteActivationEvidence(),
  );
  return advanceSingleNodeDeploymentJournal(journal, 'active');
}

/** @param {Readonly<Record<string, any>>} journal @param {string} status @param {Readonly<Record<string, string>>} [states] */
function providerObservation(journal, status = 'exact', states = {}) {
  const mapping = Object.freeze({
    firewall: 'firewall',
    'primary-ip': 'primaryIp',
    server: 'server',
  });
  return {
    status,
    resources: Object.keys(mapping).map((role) => {
      const resource = journal.resources.find(
        (/** @type {Readonly<Record<string, any>>} */ entry) =>
          entry.role === mapping[/** @type {keyof typeof mapping} */ (role)],
      );
      return {
        role,
        id:
          resource === undefined
            ? String(
                IDS[
                  /** @type {keyof typeof IDS} */ (
                    mapping[/** @type {keyof typeof mapping} */ (role)]
                  )
                ],
              )
            : String(resource.providerResourceId),
        state: states[role] ?? 'exact',
        publicIpv4:
          role === 'firewall' ||
          (states[role] !== undefined && states[role] !== 'exact')
            ? null
            : PUBLIC_IPV4,
      };
    }),
  };
}

function healthyGuest() {
  return {
    state: 'observed',
    address: PUBLIC_IPV4,
    hostKeyFingerprint: SSH_FINGERPRINT,
    service: {
      health: 'healthy',
      activeArtifactId: authority.desired.artifact.artifactId,
      activeRevisionId: authority.desired.artifact.revisionId,
      desiredMatches: true,
    },
  };
}

const NO_GUEST = Object.freeze({
  state: 'not-applicable',
  address: null,
  hostKeyFingerprint: null,
  service: null,
});

describe('single-node deployment status receipt', () => {
  it('reports exact active provider and guest evidence as healthy', () => {
    const journal = makeActiveJournal();
    const receipt = createSingleNodeDeploymentStatus({
      journal,
      providerObservation: providerObservation(journal),
      guestObservation: healthyGuest(),
    });

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      kind: SINGLE_NODE_DEPLOYMENT_STATUS_KIND,
      provider: 'hetzner',
      status: 'healthy',
      reason: null,
      nextAction: 'none',
      deployment: {
        appId: 'status-app',
        deploymentId: 'production',
        deploymentInstanceId: authority.desired.deploymentInstanceId,
        revisionId: authority.desired.artifact.revisionId,
        desiredRevisionId: authority.desired.desiredRevisionId,
      },
      journal: {
        journalId: journal.journalId,
        generation: journal.generation,
        incarnationId: journal.incarnationId,
        phase: 'active',
      },
      guest: {
        state: 'observed',
        service: { health: 'healthy', desiredMatches: true },
      },
    });
    expect(validateSingleNodeDeploymentStatus(receipt)).toEqual(receipt);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.providerState.resources)).toBe(true);
  });

  it('distinguishes active guest failure from provider conflict', () => {
    const journal = makeActiveJournal();
    const unreachable = createSingleNodeDeploymentStatus({
      journal,
      providerObservation: providerObservation(journal),
      guestObservation: {
        state: 'unreachable',
        address: PUBLIC_IPV4,
        hostKeyFingerprint: SSH_FINGERPRINT,
        service: null,
      },
    });
    expect(unreachable).toMatchObject({
      status: 'degraded',
      reason: 'guest-unreachable',
      nextAction: 'investigate-conflict',
    });

    const conflict = createSingleNodeDeploymentStatus({
      journal,
      providerObservation: providerObservation(journal, 'degraded', {
        server: 'conflict',
      }),
      guestObservation: {
        state: 'unreachable',
        address: PUBLIC_IPV4,
        hostKeyFingerprint: SSH_FINGERPRINT,
        service: null,
      },
    });
    expect(conflict).toMatchObject({
      status: 'degraded',
      reason: 'provider-conflict',
      nextAction: 'investigate-conflict',
    });
  });

  it('reports effects ahead of planned and activating journals as recovery', () => {
    const planned = makeInitialJournal();
    const plannedReceipt = createSingleNodeDeploymentStatus({
      journal: planned,
      providerObservation: providerObservation(planned),
      guestObservation: NO_GUEST,
    });
    expect(plannedReceipt).toMatchObject({
      status: 'recovery-required',
      reason: 'journal-behind-effects',
      nextAction: 'resume-apply',
    });

    let activating = recordSingleNodeDeploymentSshHost(
      makeProvisionedJournal(),
      {
        address: PUBLIC_IPV4,
        algorithm: 'ssh-ed25519',
        fingerprint: SSH_FINGERPRINT,
      },
    );
    activating = advanceSingleNodeDeploymentJournal(activating, 'activating');
    const activatingReceipt = createSingleNodeDeploymentStatus({
      journal: activating,
      providerObservation: providerObservation(activating),
      guestObservation: healthyGuest(),
    });
    expect(activatingReceipt).toMatchObject({
      status: 'recovery-required',
      reason: 'journal-behind-effects',
      nextAction: 'resume-apply',
    });
  });

  it('separates in-progress, externally completed, and durable destruction', () => {
    const provisioned = makeProvisionedJournal();
    const destroying = advanceSingleNodeDeploymentJournal(
      provisioned,
      'destroying',
    );
    const inProgress = createSingleNodeDeploymentStatus({
      journal: destroying,
      providerObservation: providerObservation(destroying, 'converging'),
      guestObservation: NO_GUEST,
    });
    expect(inProgress).toMatchObject({
      status: 'destroying',
      reason: null,
      nextAction: 'resume-destroy',
    });

    const absentStates = {
      firewall: 'absent',
      'primary-ip': 'absent',
      server: 'absent',
    };
    const externallyComplete = createSingleNodeDeploymentStatus({
      journal: destroying,
      providerObservation: providerObservation(
        destroying,
        'exact',
        absentStates,
      ),
      guestObservation: NO_GUEST,
    });
    expect(externallyComplete).toMatchObject({
      status: 'recovery-required',
      reason: 'journal-behind-effects',
      nextAction: 'resume-destroy',
    });

    let destroyed = destroying;
    for (const role of ['server', 'primaryIp', 'firewall']) {
      const resource = destroyed.resources.find(
        (/** @type {Readonly<Record<string, any>>} */ entry) =>
          entry.role === role,
      );
      destroyed = recordSingleNodeDeploymentDeletion(
        destroyed,
        createHetznerDeletionRecord(
          destroyed.providerIntent.intent,
          role,
          resource.providerResourceId,
          null,
        ),
      );
    }
    destroyed = advanceSingleNodeDeploymentJournal(destroyed, 'destroyed');
    const durable = createSingleNodeDeploymentStatus({
      journal: destroyed,
      providerObservation: providerObservation(
        destroyed,
        'exact',
        absentStates,
      ),
      guestObservation: NO_GUEST,
    });
    expect(durable).toMatchObject({
      status: 'destroyed',
      reason: null,
      nextAction: 'none',
    });
  });

  it('rejects mutated role order and disposition', () => {
    const journal = makeActiveJournal();
    const receipt = createSingleNodeDeploymentStatus({
      journal,
      providerObservation: providerObservation(journal),
      guestObservation: healthyGuest(),
    });
    const reversed = clone(receipt);
    reversed.providerState.resources.reverse();
    expect(() => validateSingleNodeDeploymentStatus(reversed)).toThrow(
      /role-sorted/iu,
    );

    const falseHealth = /** @type {Record<string, any>} */ (clone(receipt));
    falseHealth.status = 'degraded';
    falseHealth.reason = 'guest-unhealthy';
    falseHealth.nextAction = 'repair-activation';
    expect(() => validateSingleNodeDeploymentStatus(falseHealth)).toThrow(
      /disposition/iu,
    );
  });

  it('rejects secret-bearing strings before publishing a receipt', () => {
    const journal = makeInitialJournal();
    const receipt = createSingleNodeDeploymentStatus({
      journal,
      providerObservation: providerObservation(journal),
      guestObservation: NO_GUEST,
    });
    const secretBearing = clone(receipt);
    secretBearing.providerState.resources[0].id =
      'https://user:password@example.invalid/resource';

    expect(() => validateSingleNodeDeploymentStatus(secretBearing)).toThrow(
      /credential-bearing URL/iu,
    );
  });
});
