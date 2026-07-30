import { describe, expect, it } from '@jest/globals';

import { createApplicationRevision } from '../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../src/core/runtime/content-id.js';
import { createHetznerSingleNodeProvisioningIntent } from '../../src/core/runtime/providers/hetzner/single-node-provisioning.js';
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
import { createSingleNodeDeploymentJournal } from '../../src/core/runtime/single-node-deployment-journal.js';
import {
  SINGLE_NODE_DEPLOYMENT_PREVIEW_KIND,
  createSingleNodeDeploymentPreview,
  validateSingleNodeDeploymentPreview,
} from '../../src/core/runtime/single-node-deployment-preview.js';

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

function makeRevision() {
  return createApplicationRevision({
    contract: {
      schemaVersion: 4,
      app: { id: 'preview-app' },
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
      source: {
        format: 'wharfie-source-tree-v1',
        digest: digest('preview-source'),
      },
      dependencies: {
        format: 'wharfie-npm-package-lock-v3-closure-v1',
        digest: digest('preview-dependencies'),
      },
      runtime: {
        format: 'wharfie-runtime-v1',
        digest: digest('preview-runtime'),
      },
    },
  });
}

/** @param {string} bytes */
function makeDesired(bytes = 'preview-linux-sea') {
  const revision = makeRevision();
  const artifactBytes = Buffer.from(bytes);
  const artifactRecord = createArtifactRecord({
    bytes: artifactBytes,
    revision,
    target: TARGET,
    provenance: {
      schemaVersion: 1,
      builder: {
        name: '@wharfie/wharfie',
        version: '0.0.15',
        runtimeDigest: revision.inputs.runtime.digest,
        toolchainDigest: digest('preview-toolchain'),
      },
      node: {
        version: TARGET.nodeVersion,
        archive: {
          fileName: `node-v${TARGET.nodeVersion}-linux-x64.tar.gz`,
          digest: digest('preview-node-archive'),
        },
        binary: { digest: digest('preview-node-binary') },
      },
      dependencies: {
        lock: revision.inputs.dependencies,
        digest: digest('preview-dependency-closure'),
      },
      signing: { mode: 'unsigned' },
    },
  });
  const intent = createSingleNodeDeploymentIntent({
    deployment: { id: 'production' },
    appId: 'preview-app',
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

/**
 * @param {Readonly<Record<string, any>>} desired
 * @param {{owned?: boolean}} [options]
 */
async function makePlan(desired, options = {}) {
  return await resolveHetznerSingleNodePlan({
    desired,
    api: {
      listLocations: async () => [LOCATION],
      listServerTypes: async () =>
        HETZNER_SMALL_SERVER_TYPE_CANDIDATES.map(serverType),
      listImages: async () => [IMAGE],
      listFirewalls: async () => (options.owned === true ? [{}] : []),
      listPrimaryIps: async () => [],
      listServers: async () => [],
    },
  });
}

/**
 * @param {Readonly<Record<string, any>>} desired
 * @param {Readonly<Record<string, any>>} plan
 */
function makeJournal(desired, plan) {
  const intent = createHetznerSingleNodeProvisioningIntent({
    plan,
    incarnationId: createSingleNodeDeploymentIncarnationId(
      Buffer.alloc(32, 17),
    ),
    ownershipNonces: {
      firewall: sha256Base64Url('preview-firewall-nonce'),
      primaryIp: sha256Base64Url('preview-primary-ip-nonce'),
      server: sha256Base64Url('preview-server-nonce'),
    },
    cloudInitDigest: digest('#cloud-config\n'),
  });
  return createSingleNodeDeploymentJournal({
    desired,
    providerIntent: { provider: 'hetzner', intent },
  });
}

describe('single-node deployment preview receipt', () => {
  it('projects one stable redacted actionable Hetzner preview', async () => {
    const desired = makeDesired();
    const plan = await makePlan(desired);
    const preview = createSingleNodeDeploymentPreview({
      desired,
      providerPlan: plan,
      journal: null,
    });

    expect(preview).toMatchObject({
      schemaVersion: 1,
      kind: SINGLE_NODE_DEPLOYMENT_PREVIEW_KIND,
      provider: 'hetzner',
      status: 'actionable',
      blockedReason: null,
      deployment: {
        appId: 'preview-app',
        deploymentId: 'production',
        deploymentInstanceId: desired.deploymentInstanceId,
        revisionId: desired.artifact.revisionId,
        desiredRevisionId: desired.desiredRevisionId,
        artifact: {
          artifactId: desired.artifact.artifactId,
          byteDigest: desired.artifact.byteDigest,
          size: desired.artifact.size,
          target: TARGET,
        },
        mode: SINGLE_NODE_DEPLOYMENT_MODE,
        machine: SINGLE_NODE_MACHINE,
        access: {
          kind: 'public-ssh',
          allowedIpv4: ['203.0.113.7/32'],
        },
      },
      journal: {
        state: 'absent',
        phase: null,
        desiredMatches: null,
      },
      providerSpec: {
        kind: 'hetzner',
        location: { id: '1', name: 'fsn1' },
        machineType: { id: '114', name: 'cx23' },
        image: { id: '300001', name: 'ubuntu-24.04' },
        network: { kind: 'public' },
      },
      resources: {
        managed: [
          { role: 'firewall', id: null, state: 'planned' },
          { role: 'primary-ip', id: null, state: 'planned' },
          { role: 'server', id: null, state: 'planned' },
        ],
        referenced: [
          { role: 'image', id: '300001' },
          { role: 'location', id: '1' },
          { role: 'machine-type', id: '114' },
        ],
      },
      actions: [
        { kind: 'provision-managed-node' },
        { kind: 'activate-application' },
      ],
    });
    expect(validateSingleNodeDeploymentPreview(preview)).toEqual(preview);
    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview.resources.managed)).toBe(true);
    expect(JSON.stringify(preview)).not.toMatch(
      /(?:credential|secret|token|private[_-]?key)/iu,
    );
  });

  it('reports matching local authority as recovery work without trusting an unbound fresh plan', async () => {
    const desired = makeDesired();
    const plan = await makePlan(desired);
    const preview = createSingleNodeDeploymentPreview({
      desired,
      providerPlan: plan,
      journal: makeJournal(desired, plan),
    });

    expect(preview.status).toBe('recovery-required');
    expect(preview.blockedReason).toBeNull();
    expect(preview.journal).toEqual({
      state: 'present',
      phase: 'planned',
      desiredMatches: true,
    });
    expect(preview.resources.managed).toEqual([
      { role: 'firewall', id: null, state: 'pending' },
      { role: 'primary-ip', id: null, state: 'pending' },
      { role: 'server', id: null, state: 'pending' },
    ]);
    expect(preview.actions).toEqual([
      { kind: 'provision-managed-node' },
      { kind: 'activate-application' },
    ]);
  });

  it('blocks fresh unbound provider residue without projecting provider objects', async () => {
    const desired = makeDesired();
    const plan = await makePlan(desired, { owned: true });
    const preview = createSingleNodeDeploymentPreview({
      desired,
      providerPlan: plan,
      journal: null,
    });

    expect(preview.status).toBe('blocked');
    expect(preview.blockedReason).toBe('unbound-provider-resources');
    expect(preview.resources.managed).toEqual([
      { role: 'firewall', id: null, state: 'unbound' },
      { role: 'primary-ip', id: null, state: 'unbound' },
      { role: 'server', id: null, state: 'unbound' },
    ]);
    expect(preview.actions).toEqual([]);
    expect(preview).not.toHaveProperty('providerPlan');
  });

  it('blocks when local authority names another desired artifact', async () => {
    const priorDesired = makeDesired('prior-preview-linux-sea');
    const priorPlan = await makePlan(priorDesired);
    const desired = makeDesired('current-preview-linux-sea');
    const plan = await makePlan(desired);
    const preview = createSingleNodeDeploymentPreview({
      desired,
      providerPlan: plan,
      journal: makeJournal(priorDesired, priorPlan),
    });

    expect(priorDesired.deploymentInstanceId).toBe(
      desired.deploymentInstanceId,
    );
    expect(preview.status).toBe('blocked');
    expect(preview.blockedReason).toBe('local-authority-conflict');
    expect(preview.journal).toEqual({
      state: 'present',
      phase: 'planned',
      desiredMatches: false,
    });
    expect(preview.actions).toEqual([]);
  });

  it('rejects receipt mutation and provider plans for another desired state', async () => {
    const desired = makeDesired();
    const plan = await makePlan(desired);
    const preview = createSingleNodeDeploymentPreview({
      desired,
      providerPlan: plan,
      journal: null,
    });
    const mutated = JSON.parse(JSON.stringify(preview));
    mutated.resources.managed.reverse();

    expect(() => validateSingleNodeDeploymentPreview(mutated)).toThrow(
      /roles are invalid/iu,
    );
    await expect(
      Promise.resolve().then(() =>
        createSingleNodeDeploymentPreview({
          desired: makeDesired('another-artifact'),
          providerPlan: plan,
          journal: null,
        }),
      ),
    ).rejects.toThrow(/does not match/iu);
  });
});
