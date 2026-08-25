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
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import {
  createAwsDeletionRecord,
  createAwsDestructionAttempt,
  createAwsProvisionedResourceRecord,
  createAwsProvisioningMutationAttempt,
} from '../../src/core/runtime/providers/aws/single-node-journal-evidence.js';
import { createAwsSingleNodeProvisioningIntent } from '../../src/core/runtime/providers/aws/single-node-provisioning-intent.js';
import {
  AWS_SINGLE_NODE_INSTANCE_TYPE,
  resolveAwsSingleNodePlan,
} from '../../src/core/runtime/providers/aws/single-node-plan.js';
import {
  SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_DOMAIN,
  SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_PREFIX,
  SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_RECORDS,
  SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RECORD_RESERVE,
  SingleNodeDeploymentJournalConflictError,
  SingleNodeDeploymentJournalInvalidError,
  SingleNodeDeploymentJournalRecoveryReserveError,
  abandonSingleNodeDeploymentReleaseUpdate,
  advanceSingleNodeDeploymentJournal,
  completeSingleNodeDeploymentMutation,
  createSingleNodeDeploymentJournal,
  createSingleNodeDeploymentJournalStore,
  getSingleNodeDeploymentCurrentRelease,
  getSingleNodeDeploymentDestructionRecoveryState,
  getSingleNodeDeploymentEffectiveDesired,
  getSingleNodeDeploymentEffectiveTargetRelease,
  getSingleNodeDeploymentMutationAttempt,
  getSingleNodeDeploymentProvisioningRecoveryState,
  prepareSingleNodeDeploymentDestruction,
  prepareSingleNodeDeploymentMutation,
  prepareSingleNodeDeploymentMutations,
  prepareSingleNodeDeploymentReleaseUpdate,
  rejectSingleNodeDeploymentMutation,
  recordSingleNodeDeploymentActivation,
  recordSingleNodeDeploymentDeletion,
  recordSingleNodeDeploymentResource,
  recordSingleNodeDeploymentSshHost,
  settleSingleNodeDeploymentReleaseTransition,
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
const AWS_REGION = 'us-east-2';
const AWS_ACCOUNT_ID = '123456789012';
const AWS_VPC_ID = 'vpc-0123456789abcdef0';
const AWS_SUBNET_ID = 'subnet-0123456789abcdef0';
const AWS_ROUTE_TABLE_ID = 'rtb-0123456789abcdef0';
const AWS_INTERNET_GATEWAY_ID = 'igw-0123456789abcdef0';
const AWS_NETWORK_ACL_ID = 'acl-0123456789abcdef0';
const AWS_NETWORK_ACL_ASSOCIATION_ID = 'aclassoc-0123456789abcdef0';
const AWS_AMI_ID = 'ami-0123456789abcdef0';
const AWS_SNAPSHOT_ID = 'snap-0123456789abcdef0';
const AWS_SECURITY_GROUP_ID = 'sg-0123456789abcdef0';
const AWS_INSTANCE_ID = 'i-0123456789abcdef0';
const AWS_ROOT_VOLUME_ID = 'vol-0123456789abcdef0';
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
/** @type {Awaited<ReturnType<typeof makeAwsAuthority>>} */
let awsAuthority;

beforeAll(async () => {
  [authority, awsAuthority] = await Promise.all([
    makeAuthority(),
    makeAwsAuthority(),
  ]);
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

/** @param {Readonly<Record<string, any>>} value */
function resealJournal(value) {
  const payload = /** @type {any} */ (clone(value));
  delete payload.journalId;
  return sortCanonicalJsonValue({
    ...payload,
    journalId: createCanonicalJsonSha256Id({
      domain: SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_DOMAIN,
      prefix: SINGLE_NODE_DEPLOYMENT_JOURNAL_ID_PREFIX,
      value: payload,
      valuePath: 'testSingleNodeDeploymentJournal',
    }),
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

/** @param {Readonly<Record<string, any>>} [provider] @param {{variant?: string, nodeVersion?: string}} [options] */
function makeDesired(
  provider = Object.freeze({ kind: 'hetzner', location: LOCATION.name }),
  options = {},
) {
  const variant = options.variant ?? 'v1';
  const target = Object.freeze({
    ...TARGET,
    nodeVersion: options.nodeVersion ?? TARGET.nodeVersion,
  });
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
      source: {
        format: 'wharfie-source-tree-v1',
        digest: digest(`source-${variant}`),
      },
      dependencies: {
        format: 'wharfie-npm-package-lock-v3-closure-v1',
        digest: digest('dependencies'),
      },
      runtime: { format: 'wharfie-runtime-v1', digest: digest('runtime') },
    },
  });
  const bytes = Buffer.from(`exact Linux SEA payload ${variant}`);
  const artifactRecord = createArtifactRecord({
    bytes,
    revision,
    target,
    provenance: {
      schemaVersion: 1,
      builder: {
        name: '@wharfie/wharfie',
        version: '0.0.15',
        runtimeDigest: revision.inputs.runtime.digest,
        toolchainDigest: digest('toolchain'),
      },
      node: {
        version: target.nodeVersion,
        archive: {
          fileName: `node-v${target.nodeVersion}-linux-x64.tar.gz`,
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
    target,
    mode: SINGLE_NODE_DEPLOYMENT_MODE,
    machine: SINGLE_NODE_MACHINE,
    access: {
      kind: 'public-ssh',
      allowedIpv4: ['203.0.113.7/32'],
    },
    provider,
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

function makeAwsReadApi() {
  return {
    describeImages: async () => ({
      Images: [
        {
          ImageId: AWS_AMI_ID,
          OwnerId: '099720109477',
          Name: 'ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-20260701',
          CreationDate: '2026-07-01T00:00:00.000Z',
          Public: true,
          State: 'available',
          Architecture: 'x86_64',
          ImageType: 'machine',
          RootDeviceType: 'ebs',
          RootDeviceName: '/dev/sda1',
          VirtualizationType: 'hvm',
          EnaSupport: true,
          PlatformDetails: 'Linux/UNIX',
          BlockDeviceMappings: [
            {
              DeviceName: '/dev/sda1',
              Ebs: {
                SnapshotId: AWS_SNAPSHOT_ID,
                VolumeType: 'gp3',
                VolumeSize: 8,
                Encrypted: false,
                DeleteOnTermination: true,
              },
            },
            { DeviceName: '/dev/sdb', VirtualName: 'ephemeral0' },
            { DeviceName: '/dev/sdc', VirtualName: 'ephemeral1' },
          ],
        },
      ],
    }),
    describeInstanceTypeOfferings: async () => ({
      InstanceTypeOfferings: [
        {
          InstanceType: AWS_SINGLE_NODE_INSTANCE_TYPE,
          Location: 'use2-az1',
        },
      ],
    }),
    describeInstances: async () => ({ Reservations: [] }),
    describeInternetGateways: async () => ({
      InternetGateways: [
        {
          InternetGatewayId: AWS_INTERNET_GATEWAY_ID,
          OwnerId: AWS_ACCOUNT_ID,
          Attachments: [{ VpcId: AWS_VPC_ID, State: 'available' }],
        },
      ],
    }),
    describeNetworkAcls: async () => ({
      NetworkAcls: [
        {
          NetworkAclId: AWS_NETWORK_ACL_ID,
          VpcId: AWS_VPC_ID,
          OwnerId: AWS_ACCOUNT_ID,
          IsDefault: true,
          Associations: [
            {
              NetworkAclAssociationId: AWS_NETWORK_ACL_ASSOCIATION_ID,
              NetworkAclId: AWS_NETWORK_ACL_ID,
              SubnetId: AWS_SUBNET_ID,
            },
          ],
          Entries: [
            {
              RuleNumber: 100,
              Protocol: '-1',
              RuleAction: 'allow',
              Egress: false,
              CidrBlock: '0.0.0.0/0',
            },
            {
              RuleNumber: 101,
              Protocol: '-1',
              RuleAction: 'allow',
              Egress: false,
              Ipv6CidrBlock: '::/0',
            },
            {
              RuleNumber: 32767,
              Protocol: '-1',
              RuleAction: 'deny',
              Egress: false,
              CidrBlock: '0.0.0.0/0',
            },
            {
              RuleNumber: 32767,
              Protocol: '-1',
              RuleAction: 'deny',
              Egress: false,
              Ipv6CidrBlock: '::/0',
            },
            {
              RuleNumber: 100,
              Protocol: '-1',
              RuleAction: 'allow',
              Egress: true,
              CidrBlock: '0.0.0.0/0',
            },
            {
              RuleNumber: 101,
              Protocol: '-1',
              RuleAction: 'allow',
              Egress: true,
              Ipv6CidrBlock: '::/0',
            },
            {
              RuleNumber: 32767,
              Protocol: '-1',
              RuleAction: 'deny',
              Egress: true,
              CidrBlock: '0.0.0.0/0',
            },
            {
              RuleNumber: 32767,
              Protocol: '-1',
              RuleAction: 'deny',
              Egress: true,
              Ipv6CidrBlock: '::/0',
            },
          ],
        },
      ],
    }),
    describeRouteTables: async () => ({
      RouteTables: [
        {
          RouteTableId: AWS_ROUTE_TABLE_ID,
          VpcId: AWS_VPC_ID,
          OwnerId: AWS_ACCOUNT_ID,
          Associations: [{ Main: true }],
          Routes: [
            {
              DestinationCidrBlock: '0.0.0.0/0',
              GatewayId: AWS_INTERNET_GATEWAY_ID,
              Origin: 'CreateRoute',
              State: 'active',
            },
          ],
        },
      ],
    }),
    describeSecurityGroups: async () => ({ SecurityGroups: [] }),
    describeSubnets: async () => ({
      Subnets: [
        {
          SubnetId: AWS_SUBNET_ID,
          VpcId: AWS_VPC_ID,
          OwnerId: AWS_ACCOUNT_ID,
          State: 'available',
          DefaultForAz: true,
          MapPublicIpOnLaunch: true,
          AssignIpv6AddressOnCreation: false,
          Ipv6Native: false,
          AvailableIpAddressCount: 4091,
          AvailabilityZone: 'us-east-2a',
          AvailabilityZoneId: 'use2-az1',
        },
      ],
    }),
    describeVolumes: async () => ({ Volumes: [] }),
    describeVpcs: async () => ({
      Vpcs: [
        {
          VpcId: AWS_VPC_ID,
          OwnerId: AWS_ACCOUNT_ID,
          IsDefault: true,
          State: 'available',
        },
      ],
    }),
  };
}

async function makeAwsAuthority() {
  const desired = makeDesired({ kind: 'aws', region: AWS_REGION });
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: AWS_ACCOUNT_ID,
    region: AWS_REGION,
  });
  const plan = await resolveAwsSingleNodePlan({
    desired,
    providerScope,
    api: makeAwsReadApi(),
  });
  const provisioningIntent = createAwsSingleNodeProvisioningIntent({
    plan,
    incarnationId: createSingleNodeDeploymentIncarnationId(
      Buffer.alloc(32, 29),
    ),
    cloudInitDigest: digest('#cloud-config\n'),
  });
  return Object.freeze({
    desired,
    providerIntent: Object.freeze({
      provider: 'aws',
      intent: provisioningIntent,
    }),
  });
}

/** @param {Readonly<Record<string, any>>} [selectedAuthority] */
async function makeStore(selectedAuthority = authority) {
  const parent = await mkdtemp(join(tmpdir(), 'wharfie-single-node-journal-'));
  temporaryRoots.push(parent);
  await chmod(parent, 0o700);
  const dataRoot = join(parent, 'data');
  const store = createSingleNodeDeploymentJournalStore({
    appId: selectedAuthority.desired.intent.appId,
    deploymentInstanceId: selectedAuthority.desired.deploymentInstanceId,
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

function remoteActivationEvidence(desired = authority.desired) {
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

function createActive() {
  let record = recordSingleNodeDeploymentSshHost(createProvisioned(), {
    address: PUBLIC_IPV4,
    algorithm: 'ssh-ed25519',
    fingerprint: SSH_FINGERPRINT,
  });
  record = advanceSingleNodeDeploymentJournal(record, 'activating');
  record = recordSingleNodeDeploymentActivation(
    record,
    remoteActivationEvidence(),
  );
  record = settleSingleNodeDeploymentReleaseTransition(record);
  return advanceSingleNodeDeploymentJournal(record, 'active');
}

/** @param {Readonly<Record<string, any>>} record @param {string} role @param {string} id @param {string|null} publicIpv4 */
function completeAwsRole(record, role, id, publicIpv4 = null) {
  const prepared =
    getSingleNodeDeploymentMutationAttempt(record, role) === null
      ? prepareSingleNodeDeploymentMutation(
          record,
          createAwsProvisioningMutationAttempt(
            awsAuthority.providerIntent.intent,
            role,
          ),
        )
      : record;
  const completed = completeSingleNodeDeploymentMutation(
    prepared,
    createAwsProvisionedResourceRecord(
      awsAuthority.providerIntent.intent,
      role,
      id,
    ),
  );
  if (publicIpv4 === null) return completed;
  const resource = completed.resources.find(
    (/** @type {Record<string, any>} */ entry) => entry.role === role,
  );
  if (resource === undefined) {
    throw new Error('test AWS resource was not recorded');
  }
  return recordSingleNodeDeploymentResource(completed, {
    ...resource,
    publicIpv4,
  });
}

/** @param {Readonly<Record<string, any>>} record */
function prepareAwsCompute(record) {
  return prepareSingleNodeDeploymentMutations(record, [
    createAwsProvisioningMutationAttempt(
      awsAuthority.providerIntent.intent,
      'instance',
    ),
    createAwsProvisioningMutationAttempt(
      awsAuthority.providerIntent.intent,
      'rootVolume',
    ),
  ]);
}

function createAwsProvisioned() {
  let record = advanceSingleNodeDeploymentJournal(
    createSingleNodeDeploymentJournal(awsAuthority),
    'provisioning',
  );
  record = completeAwsRole(record, 'securityGroup', AWS_SECURITY_GROUP_ID);
  record = prepareAwsCompute(record);
  record = completeAwsRole(record, 'instance', AWS_INSTANCE_ID, PUBLIC_IPV4);
  record = completeAwsRole(record, 'rootVolume', AWS_ROOT_VOLUME_ID);
  return advanceSingleNodeDeploymentJournal(record, 'provisioned');
}

describe('single-node deployment journal contract', () => {
  it('seals credential-free immutable authority before the first mutation', () => {
    const journal = createInitial();

    expect(journal).toMatchObject({
      schemaVersion: 3,
      kind: 'singleNodeDeploymentJournal',
      journalId: expect.stringMatching(/^wsnj3_[A-Za-z0-9_-]{43}$/u),
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
      release: {
        current: null,
        rollback: null,
        transition: {
          kind: 'install',
          target: {
            desired: authority.desired,
            artifact: null,
            activation: null,
          },
        },
      },
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

  it('durably releases only a matching prepared fence after a known rejection', () => {
    const provisioning = advanceSingleNodeDeploymentJournal(
      createInitial(),
      'provisioning',
    );
    const providerFence = providerAttempt('server');
    const prepared = prepareSingleNodeDeploymentMutation(
      provisioning,
      providerFence,
    );

    const rejected = rejectSingleNodeDeploymentMutation(
      prepared,
      providerFence,
    );

    expect(rejected.generation).toBe(prepared.generation + 1);
    expect(rejected.previousJournalId).toBe(prepared.journalId);
    expect(
      getSingleNodeDeploymentMutationAttempt(rejected, 'server'),
    ).toBeNull();
    expect(
      validateSingleNodeDeploymentJournalSuccessor(prepared, rejected),
    ).toEqual(rejected);
    expect(
      prepareSingleNodeDeploymentMutation(rejected, providerFence),
    ).toMatchObject({
      generation: rejected.generation + 1,
      mutationAttempts: [
        expect.objectContaining({ role: 'server', state: 'prepared' }),
      ],
    });
    expect(() =>
      rejectSingleNodeDeploymentMutation(
        prepared,
        providerAttempt('primaryIp'),
      ),
    ).toThrow(/does not match/iu);

    const completed = completeSingleNodeDeploymentMutation(
      prepared,
      providerResource('server', 42),
    );
    expect(() =>
      rejectSingleNodeDeploymentMutation(completed, providerFence),
    ).toThrow(/does not match/iu);
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
    record = settleSingleNodeDeploymentReleaseTransition(record);
    record = advanceSingleNodeDeploymentJournal(record, 'active');

    expect(record.phase).toBe('active');
    expect(record.sshHost.address).toBe(PUBLIC_IPV4);
    expect(record.release.current.artifact.artifactId).toBe(
      authority.desired.artifact.artifactId,
    );
    expect(record.release.current.activation).toEqual(evidence);
    expect(record.release.current.activation.activationEvidenceId).toMatch(
      /^wsne1_[A-Za-z0-9_-]{43}$/u,
    );
    expect(record.release.current.artifact.remotePath).toBe(
      evidence.artifact.remotePath,
    );
    expect(getSingleNodeDeploymentCurrentRelease(record)).toEqual(
      record.release.current,
    );
    expect(getSingleNodeDeploymentEffectiveTargetRelease(record)).toEqual(
      record.release.current,
    );
    expect(getSingleNodeDeploymentEffectiveDesired(record)).toEqual(
      authority.desired,
    );
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

  it('keeps current authoritative until an update settles and retains one rollback release', () => {
    let record = createProvisioned();
    record = recordSingleNodeDeploymentSshHost(record, {
      address: PUBLIC_IPV4,
      algorithm: 'ssh-ed25519',
      fingerprint: SSH_FINGERPRINT,
    });
    record = advanceSingleNodeDeploymentJournal(record, 'activating');
    record = recordSingleNodeDeploymentActivation(
      record,
      remoteActivationEvidence(),
    );
    record = settleSingleNodeDeploymentReleaseTransition(record);
    record = advanceSingleNodeDeploymentJournal(record, 'active');
    const installed = getSingleNodeDeploymentCurrentRelease(record);
    const updatedDesired = makeDesired(undefined, {
      variant: 'v2',
      nodeVersion: '24.14.0',
    });

    const prepared = prepareSingleNodeDeploymentReleaseUpdate(
      record,
      updatedDesired,
    );
    expect(getSingleNodeDeploymentCurrentRelease(prepared)).toEqual(installed);
    expect(getSingleNodeDeploymentEffectiveDesired(prepared)).toEqual(
      updatedDesired,
    );
    expect(
      validateSingleNodeDeploymentJournalSuccessor(record, prepared),
    ).toEqual(prepared);
    expect(
      prepareSingleNodeDeploymentReleaseUpdate(prepared, updatedDesired),
    ).toEqual(prepared);

    const activated = recordSingleNodeDeploymentActivation(
      prepared,
      remoteActivationEvidence(updatedDesired),
    );
    expect(getSingleNodeDeploymentCurrentRelease(activated)).toEqual(installed);
    expect(
      validateSingleNodeDeploymentJournalSuccessor(prepared, activated),
    ).toEqual(activated);

    const settled = settleSingleNodeDeploymentReleaseTransition(activated);
    expect(settled.release.transition).toBeNull();
    expect(settled.release.current.desired).toEqual(updatedDesired);
    expect(settled.release.rollback).toEqual(installed);
    expect(
      validateSingleNodeDeploymentJournalSuccessor(activated, settled),
    ).toEqual(settled);
    expect(
      prepareSingleNodeDeploymentReleaseUpdate(settled, updatedDesired),
    ).toEqual(settled);
  });

  it('abandons a failed update while preserving committed current and rollback releases', () => {
    let record = createActive();
    const secondDesired = makeDesired(undefined, {
      variant: 'v2',
      nodeVersion: '24.14.0',
    });
    record = prepareSingleNodeDeploymentReleaseUpdate(record, secondDesired);
    record = recordSingleNodeDeploymentActivation(
      record,
      remoteActivationEvidence(secondDesired),
    );
    record = settleSingleNodeDeploymentReleaseTransition(record);

    const current = record.release.current;
    const rollback = record.release.rollback;
    const thirdDesired = makeDesired(undefined, {
      variant: 'v3',
      nodeVersion: '24.15.0',
    });
    const pending = prepareSingleNodeDeploymentReleaseUpdate(
      record,
      thirdDesired,
    );
    const abandoned = abandonSingleNodeDeploymentReleaseUpdate(pending);

    expect(abandoned.generation).toBe(pending.generation + 1);
    expect(abandoned.previousJournalId).toBe(pending.journalId);
    expect(abandoned.release).toEqual({
      current,
      rollback,
      transition: null,
    });
    expect(
      validateSingleNodeDeploymentJournalSuccessor(pending, abandoned),
    ).toEqual(abandoned);
  });

  it('rejects update abandonment for stable, install, and non-active journals', () => {
    const active = createActive();
    expect(() => abandonSingleNodeDeploymentReleaseUpdate(active)).toThrow(
      /active release update/iu,
    );

    let installing = recordSingleNodeDeploymentSshHost(createProvisioned(), {
      address: PUBLIC_IPV4,
      algorithm: 'ssh-ed25519',
      fingerprint: SSH_FINGERPRINT,
    });
    installing = advanceSingleNodeDeploymentJournal(installing, 'activating');
    expect(() => abandonSingleNodeDeploymentReleaseUpdate(installing)).toThrow(
      /active release update/iu,
    );

    const pending = prepareSingleNodeDeploymentReleaseUpdate(
      active,
      makeDesired(undefined, { variant: 'v2' }),
    );
    const destroying = advanceSingleNodeDeploymentJournal(
      pending,
      'destroying',
    );
    expect(() => abandonSingleNodeDeploymentReleaseUpdate(destroying)).toThrow(
      /active release update/iu,
    );
  });

  it('rejects a resealed abandonment successor that tampers with rollback authority', () => {
    const active = createActive();
    const pending = prepareSingleNodeDeploymentReleaseUpdate(
      active,
      makeDesired(undefined, { variant: 'v2' }),
    );
    const abandoned = abandonSingleNodeDeploymentReleaseUpdate(pending);
    const tampered = /** @type {any} */ (clone(abandoned));
    tampered.release.rollback = active.release.current;
    const resealed = resealJournal(tampered);

    expect(validateSingleNodeDeploymentJournal(resealed)).toEqual(resealed);
    expect(() =>
      validateSingleNodeDeploymentJournalSuccessor(pending, resealed),
    ).toThrow(/incomplete release transition|legal transition/iu);
  });

  it('reserves final journal records without blocking repair or an in-flight update', () => {
    const active = createActive();
    const target = makeDesired(undefined, { variant: 'v2' });
    const firstRefusedGeneration =
      SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_RECORDS -
      SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RECORD_RESERVE -
      3;
    const lastAllowed = /** @type {any} */ (clone(active));
    lastAllowed.generation = firstRefusedGeneration - 1;
    lastAllowed.previousJournalId = active.journalId;
    expect(
      prepareSingleNodeDeploymentReleaseUpdate(
        resealJournal(lastAllowed),
        target,
      ),
    ).toMatchObject({ generation: firstRefusedGeneration });

    const nearCapacity = /** @type {any} */ (clone(active));
    nearCapacity.generation = firstRefusedGeneration;
    nearCapacity.previousJournalId = active.journalId;
    const stable = resealJournal(nearCapacity);

    expect(
      prepareSingleNodeDeploymentReleaseUpdate(
        stable,
        stable.release.current.desired,
      ),
    ).toEqual(stable);
    expect(() =>
      prepareSingleNodeDeploymentReleaseUpdate(stable, target),
    ).toThrow(SingleNodeDeploymentJournalRecoveryReserveError);

    const pending = prepareSingleNodeDeploymentReleaseUpdate(active, target);
    const latePending = /** @type {any} */ (clone(pending));
    latePending.generation =
      SINGLE_NODE_DEPLOYMENT_JOURNAL_MAX_RECORDS -
      SINGLE_NODE_DEPLOYMENT_JOURNAL_RECOVERY_RECORD_RESERVE;
    latePending.previousJournalId = pending.journalId;
    const resumable = resealJournal(latePending);
    expect(prepareSingleNodeDeploymentReleaseUpdate(resumable, target)).toEqual(
      resumable,
    );
    const activated = recordSingleNodeDeploymentActivation(
      resumable,
      remoteActivationEvidence(target),
    );
    expect(
      settleSingleNodeDeploymentReleaseTransition(activated),
    ).toMatchObject({
      generation: resumable.generation + 2,
      release: { transition: null },
    });
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

describe('single-node deployment journal AWS v3 contract', () => {
  it('round-trips exact AWS plan, scope, and incarnation authority while rejecting v2', () => {
    const initial = createSingleNodeDeploymentJournal(awsAuthority);

    expect(initial).toMatchObject({
      schemaVersion: 3,
      journalId: expect.stringMatching(/^wsnj3_[A-Za-z0-9_-]{43}$/u),
      phase: 'planned',
      providerIntent: {
        provider: 'aws',
        intent: {
          provisioningIntentId: expect.stringMatching(
            /^wsapi1_[A-Za-z0-9_-]{43}$/u,
          ),
          plan: {
            planId: awsAuthority.providerIntent.intent.plan.planId,
            providerSpec: {
              providerScope:
                awsAuthority.providerIntent.intent.plan.providerSpec
                  .providerScope,
            },
          },
        },
      },
    });
    expect(validateSingleNodeDeploymentJournal(clone(initial))).toEqual(
      initial,
    );

    const legacy = /** @type {any} */ (clone(initial));
    legacy.schemaVersion = 2;
    expect(() => validateSingleNodeDeploymentJournal(legacy)).toThrow(
      /unsupported schema/iu,
    );

    const wrongScope = /** @type {any} */ (clone(awsAuthority));
    wrongScope.providerIntent.intent.plan.providerSpec.providerScope.accountId =
      '999999999999';
    expect(() => createSingleNodeDeploymentJournal(wrongScope)).toThrow();
  });

  it('enforces AWS provider roles, canonical IDs, and instance-only address authority', () => {
    let record = advanceSingleNodeDeploymentJournal(
      createSingleNodeDeploymentJournal(awsAuthority),
      'provisioning',
    );

    expect(() =>
      completeSingleNodeDeploymentMutation(
        record,
        createAwsProvisionedResourceRecord(
          awsAuthority.providerIntent.intent,
          'securityGroup',
          AWS_SECURITY_GROUP_ID,
        ),
      ),
    ).toThrow(/not durably prepared/iu);
    expect(() =>
      createAwsProvisionedResourceRecord(
        awsAuthority.providerIntent.intent,
        'securityGroup',
        AWS_INSTANCE_ID,
      ),
    ).toThrow(/canonical securityGroup/iu);

    record = completeAwsRole(record, 'securityGroup', AWS_SECURITY_GROUP_ID);
    expect(() =>
      recordSingleNodeDeploymentResource(record, {
        ...record.resources[0],
        provider: 'hetzner',
      }),
    ).toThrow(/provider does not match/iu);
    expect(() =>
      recordSingleNodeDeploymentResource(record, {
        ...record.resources[0],
        publicIpv4: PUBLIC_IPV4,
      }),
    ).toThrow(/unsupported for this provider role/iu);

    record = prepareAwsCompute(record);
    record = completeAwsRole(record, 'instance', AWS_INSTANCE_ID, PUBLIC_IPV4);
    record = completeAwsRole(record, 'rootVolume', AWS_ROOT_VOLUME_ID);
    expect(() =>
      recordSingleNodeDeploymentResource(record, {
        ...record.resources.find(
          (/** @type {Record<string, any>} */ resource) =>
            resource.role === 'rootVolume',
        ),
        publicIpv4: PUBLIC_IPV4,
      }),
    ).toThrow(/unsupported for this provider role/iu);

    record = advanceSingleNodeDeploymentJournal(record, 'provisioned');
    record = recordSingleNodeDeploymentSshHost(record, {
      address: PUBLIC_IPV4,
      algorithm: 'ssh-ed25519',
      fingerprint: SSH_FINGERPRINT,
    });
    expect(record.sshHost.address).toBe(PUBLIC_IPV4);
    expect(getSingleNodeDeploymentProvisioningRecoveryState(record)).toEqual({
      storedResourceIds: {
        securityGroup: AWS_SECURITY_GROUP_ID,
        instance: AWS_INSTANCE_ID,
        rootVolume: AWS_ROOT_VOLUME_ID,
      },
      storedMutationAttempts: {
        securityGroup: createAwsProvisioningMutationAttempt(
          awsAuthority.providerIntent.intent,
          'securityGroup',
        ),
        instance: createAwsProvisioningMutationAttempt(
          awsAuthority.providerIntent.intent,
          'instance',
        ),
        rootVolume: createAwsProvisioningMutationAttempt(
          awsAuthority.providerIntent.intent,
          'rootVolume',
        ),
      },
    });
    expect(validateSingleNodeDeploymentJournal(clone(record))).toEqual(record);
  });

  it('persists the AWS instance and root-volume fences in one CAS generation', () => {
    const provisioning = advanceSingleNodeDeploymentJournal(
      createSingleNodeDeploymentJournal(awsAuthority),
      'provisioning',
    );
    const instance = createAwsProvisioningMutationAttempt(
      awsAuthority.providerIntent.intent,
      'instance',
    );
    const rootVolume = createAwsProvisioningMutationAttempt(
      awsAuthority.providerIntent.intent,
      'rootVolume',
    );
    expect(() =>
      prepareSingleNodeDeploymentMutation(provisioning, instance),
    ).toThrow(/fence the AWS instance and root volume atomically/iu);
    expect(() =>
      prepareSingleNodeDeploymentMutation(provisioning, rootVolume),
    ).toThrow(/fence the AWS instance and root volume atomically/iu);
    const prepared = prepareSingleNodeDeploymentMutations(provisioning, [
      rootVolume,
      instance,
    ]);

    expect(prepared.generation).toBe(provisioning.generation + 1);
    expect(
      prepared.mutationAttempts.map(
        (/** @type {Record<string, any>} */ attempt) => attempt.role,
      ),
    ).toEqual(['instance', 'rootVolume']);
    expect(
      prepareSingleNodeDeploymentMutations(prepared, [instance, rootVolume]),
    ).toEqual(prepared);
    expect(() =>
      prepareSingleNodeDeploymentMutations(provisioning, [instance, instance]),
    ).toThrow(/unique roles/iu);
    expect(() =>
      prepareSingleNodeDeploymentMutations(provisioning, []),
    ).toThrow(/nonempty and bounded/iu);

    const conflictingIntent = createAwsSingleNodeProvisioningIntent({
      plan: awsAuthority.providerIntent.intent.plan,
      incarnationId: createSingleNodeDeploymentIncarnationId(
        Buffer.alloc(32, 31),
      ),
      cloudInitDigest: awsAuthority.providerIntent.intent.cloudInitDigest,
    });
    expect(() =>
      prepareSingleNodeDeploymentMutations(prepared, [
        createAwsProvisioningMutationAttempt(conflictingIntent, 'instance'),
      ]),
    ).toThrow(/immutable authority/iu);
    expect(
      validateSingleNodeDeploymentJournalSuccessor(provisioning, prepared),
    ).toEqual(prepared);
  });

  it('orders AWS destruction instance, root volume, then security group', () => {
    let record = advanceSingleNodeDeploymentJournal(
      createAwsProvisioned(),
      'destroying',
    );
    /** @param {string} role @param {string} id */
    const attemptFor = (role, id) =>
      createAwsDestructionAttempt(awsAuthority.providerIntent.intent, role, id);
    /** @param {string} role @param {string} id */
    const deleteFor = (role, id) => {
      const attempt =
        record.destroyAttempts.find(
          (/** @type {Record<string, any>} */ entry) => entry.role === role,
        ) ?? null;
      return createAwsDeletionRecord(
        awsAuthority.providerIntent.intent,
        role,
        id,
        attempt,
      );
    };

    expect(() =>
      prepareSingleNodeDeploymentDestruction(
        record,
        attemptFor('rootVolume', AWS_ROOT_VOLUME_ID),
      ),
    ).toThrow(/instance to be absent first/iu);
    expect(() =>
      prepareSingleNodeDeploymentDestruction(
        record,
        attemptFor('securityGroup', AWS_SECURITY_GROUP_ID),
      ),
    ).toThrow(/instance and root volume/iu);

    record = prepareSingleNodeDeploymentDestruction(
      record,
      attemptFor('instance', AWS_INSTANCE_ID),
    );
    record = recordSingleNodeDeploymentDeletion(
      record,
      deleteFor('instance', AWS_INSTANCE_ID),
    );
    record = prepareSingleNodeDeploymentDestruction(
      record,
      attemptFor('rootVolume', AWS_ROOT_VOLUME_ID),
    );
    record = recordSingleNodeDeploymentDeletion(
      record,
      deleteFor('rootVolume', AWS_ROOT_VOLUME_ID),
    );
    record = prepareSingleNodeDeploymentDestruction(
      record,
      attemptFor('securityGroup', AWS_SECURITY_GROUP_ID),
    );
    record = recordSingleNodeDeploymentDeletion(
      record,
      deleteFor('securityGroup', AWS_SECURITY_GROUP_ID),
    );

    expect(
      record.destroyAttempts.map(
        (/** @type {Record<string, any>} */ attempt) => attempt.role,
      ),
    ).toEqual(['instance', 'rootVolume', 'securityGroup']);
    expect(
      record.deletionRecords.map(
        (/** @type {Record<string, any>} */ deletion) => deletion.role,
      ),
    ).toEqual(['instance', 'rootVolume', 'securityGroup']);
    expect(
      getSingleNodeDeploymentDestructionRecoveryState(record),
    ).toMatchObject({
      storedResourceIds: {
        instance: AWS_INSTANCE_ID,
        rootVolume: AWS_ROOT_VOLUME_ID,
        securityGroup: AWS_SECURITY_GROUP_ID,
      },
    });
    record = advanceSingleNodeDeploymentJournal(record, 'destroyed');
    expect(record.phase).toBe('destroyed');
  });

  it('retains AWS content integrity and rejects stale CAS publication', async () => {
    const { store } = await makeStore(awsAuthority);
    const initial = await store.initialize(awsAuthority);
    const provisioning = advanceSingleNodeDeploymentJournal(
      initial,
      'provisioning',
    );
    await store.commit(commitRequest(initial, provisioning));

    const tampered = /** @type {any} */ (clone(provisioning));
    tampered.providerIntent.intent.incarnationId =
      authority.providerIntent.intent.incarnationId;
    expect(() => validateSingleNodeDeploymentJournal(tampered)).toThrow();
    await expect(
      store.commit(
        commitRequest(
          initial,
          advanceSingleNodeDeploymentJournal(initial, 'destroying'),
        ),
      ),
    ).rejects.toBeInstanceOf(SingleNodeDeploymentJournalConflictError);
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

    expect(store.paths.deploymentsRoot).toMatch(
      /single-node-deployments\/v3$/u,
    );
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
  }, 15_000);

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
