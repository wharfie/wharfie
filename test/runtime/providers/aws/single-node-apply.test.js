import { createHash } from 'node:crypto';
import path from 'node:path';

import { describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../../src/core/runtime/artifact-record.js';
import { sortCanonicalJsonValue } from '../../../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../../../src/core/runtime/content-id.js';
import { createAwsProviderScope } from '../../../../src/core/runtime/deployment-provider-scope.js';
import {
  AWS_SINGLE_NODE_APPLY_RESULT_KIND,
  AWS_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
  createAwsSingleNodeApplyCoordinator,
} from '../../../../src/core/runtime/providers/aws/single-node-apply.js';
import {
  createAwsProvisionedResourceRecord,
  createAwsProvisioningMutationAttempt,
} from '../../../../src/core/runtime/providers/aws/single-node-journal-evidence.js';
import {
  AWS_SINGLE_NODE_INSTANCE_TYPE,
  AWS_SINGLE_NODE_UBUNTU_PARAMETER,
  resolveAwsSingleNodePlan,
} from '../../../../src/core/runtime/providers/aws/single-node-plan.js';
import {
  createSingleNodeDeploymentJournal,
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

const REGION = 'us-east-2';
const ACCOUNT_ID = '123456789012';
const OTHER_ACCOUNT_ID = '210987654321';
const VPC_ID = 'vpc-0123456789abcdef0';
const SUBNET_ID = 'subnet-0123456789abcdef0';
const ROUTE_TABLE_ID = 'rtb-0123456789abcdef0';
const INTERNET_GATEWAY_ID = 'igw-0123456789abcdef0';
const NETWORK_ACL_ID = 'acl-0123456789abcdef0';
const NETWORK_ACL_ASSOCIATION_ID = 'aclassoc-0123456789abcdef0';
const AMI_ID = 'ami-0123456789abcdef0';
const SNAPSHOT_ID = 'snap-0123456789abcdef0';
const SECURITY_GROUP_ID = 'sg-0123456789abcdef0';
const INSTANCE_ID = 'i-0123456789abcdef0';
const VOLUME_ID = 'vol-0123456789abcdef0';
const PUBLIC_IPV4 = '203.0.113.40';
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const HOST_FINGERPRINT = `SHA256:${Buffer.alloc(32, 29)
  .toString('base64')
  .replace(/=+$/u, '')}`;

/** @param {string|Buffer|Uint8Array} value */
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
    privateKeyPath: '/tmp/wharfie-aws-apply-test/id_ed25519',
    publicKey: `ssh-ed25519 ${blob.toString('base64')}`,
    publicKeyFingerprint: `SHA256:${createHash('sha256')
      .update(blob)
      .digest('base64')
      .replace(/=+$/u, '')}`,
    knownHostsPath: '/tmp/wharfie-aws-apply-test/known_hosts',
  });
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
      allowedIpv4: ['203.0.113.9/32', '203.0.113.7/32'],
    },
    provider: { kind: 'aws', region: REGION },
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

function networkAclResponse() {
  const Entries = [];
  for (const Egress of [false, true]) {
    Entries.push(
      {
        RuleNumber: 100,
        Protocol: '-1',
        RuleAction: 'allow',
        Egress,
        CidrBlock: '0.0.0.0/0',
      },
      {
        RuleNumber: 32767,
        Protocol: '-1',
        RuleAction: 'deny',
        Egress,
        CidrBlock: '0.0.0.0/0',
      },
    );
  }
  return {
    NetworkAcls: [
      {
        NetworkAclId: NETWORK_ACL_ID,
        VpcId: VPC_ID,
        OwnerId: ACCOUNT_ID,
        IsDefault: true,
        Associations: [
          {
            NetworkAclAssociationId: NETWORK_ACL_ASSOCIATION_ID,
            NetworkAclId: NETWORK_ACL_ID,
            SubnetId: SUBNET_ID,
          },
        ],
        Entries,
      },
    ],
  };
}

function makePlanApi() {
  return {
    getParameter: async () => ({
      Parameter: {
        Name: AWS_SINGLE_NODE_UBUNTU_PARAMETER,
        Type: 'String',
        Value: AMI_ID,
        Version: 42,
        ARN: `arn:aws:ssm:${REGION}::parameter${AWS_SINGLE_NODE_UBUNTU_PARAMETER}`,
        DataType: 'text',
        LastModifiedDate: new Date('2026-07-01T00:00:00.000Z'),
      },
    }),
    describeImages: async () => ({
      Images: [
        {
          ImageId: AMI_ID,
          OwnerId: '099720109477',
          Public: true,
          State: 'available',
          Architecture: 'x86_64',
          ImageType: 'machine',
          RootDeviceType: 'ebs',
          RootDeviceName: '/dev/sda1',
          VirtualizationType: 'hvm',
          EnaSupport: true,
          PlatformDetails: 'Linux/UNIX',
          PublicSsmParameterName: AWS_SINGLE_NODE_UBUNTU_PARAMETER.slice(1),
          BlockDeviceMappings: [
            {
              DeviceName: '/dev/sda1',
              Ebs: {
                SnapshotId: SNAPSHOT_ID,
                VolumeType: 'gp3',
                VolumeSize: 8,
                Encrypted: false,
                DeleteOnTermination: true,
              },
            },
          ],
        },
      ],
    }),
    describeInstanceTypeOfferings: async () => ({
      InstanceTypeOfferings: [
        { InstanceType: AWS_SINGLE_NODE_INSTANCE_TYPE, Location: 'use2-az1' },
      ],
    }),
    describeInstances: async () => ({ Reservations: [] }),
    describeInternetGateways: async () => ({
      InternetGateways: [
        {
          InternetGatewayId: INTERNET_GATEWAY_ID,
          OwnerId: ACCOUNT_ID,
          Attachments: [{ VpcId: VPC_ID, State: 'available' }],
        },
      ],
    }),
    describeNetworkAcls: async () => networkAclResponse(),
    describeRouteTables: async () => ({
      RouteTables: [
        {
          RouteTableId: ROUTE_TABLE_ID,
          VpcId: VPC_ID,
          OwnerId: ACCOUNT_ID,
          Associations: [{ Main: true }],
          Routes: [
            {
              DestinationCidrBlock: '0.0.0.0/0',
              GatewayId: INTERNET_GATEWAY_ID,
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
          SubnetId: SUBNET_ID,
          VpcId: VPC_ID,
          OwnerId: ACCOUNT_ID,
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
          VpcId: VPC_ID,
          OwnerId: ACCOUNT_ID,
          IsDefault: true,
          State: 'available',
        },
      ],
    }),
  };
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
 * @typedef {'securityGroupPrepared'|'computePrepared'} CrashStage
 * @typedef {{crashStage?: CrashStage, operationAccountId?: string}} HarnessOptions
 */

/**
 * @param {HarnessOptions} [options]
 */
async function makeHarness(options = {}) {
  const fixture = makeFixture();
  const sshIdentity = makeSshIdentity();
  const scope = createAwsProviderScope({
    partition: 'aws',
    accountId: ACCOUNT_ID,
    region: REGION,
  });
  const otherScope = createAwsProviderScope({
    partition: 'aws',
    accountId: OTHER_ACCOUNT_ID,
    region: REGION,
  });
  const plan = await resolveAwsSingleNodePlan({
    desired: fixture.desired,
    providerScope: scope,
    api: makePlanApi(),
  });
  /** @type {Readonly<Record<string, any>>|null} */
  let journal = null;
  /** @type {Readonly<Record<string, any>>} */
  let readScope = scope;
  /** @type {Readonly<Record<string, any>>} */
  let operationScope =
    options.operationAccountId === OTHER_ACCOUNT_ID ? otherScope : scope;
  /** @type {string[]} */
  const events = [];
  /** @type {Readonly<Record<string, any>>[]} */
  const recoveries = [];
  /** @type {string[][]} */
  const mutationBatches = [];
  /** @type {ReturnType<typeof jest.fn>[]} */
  const readCloses = [];
  /** @type {ReturnType<typeof jest.fn>[]} */
  const operationCloses = [];
  let convergeCalls = 0;
  let planCalls = 0;
  let verifyCalls = 0;
  const release = jest.fn(async () => undefined);
  const api = {
    ...makePlanApi(),
    describeInstanceCreditSpecifications: async () => ({
      InstanceCreditSpecifications: [
        { InstanceId: INSTANCE_ID, CpuCredits: 'standard' },
      ],
    }),
    createSecurityGroup: async () => {
      throw new Error('test converger owns provider mutations');
    },
    authorizeSecurityGroupIngress: async () => {
      throw new Error('test converger owns provider mutations');
    },
    runInstances: async () => {
      throw new Error('test converger owns provider mutations');
    },
  };

  /**
   * @param {'read'|'operation'} mode
   */
  function authority(mode) {
    const close = jest.fn(async () => {
      events.push(`${mode}-close`);
    });
    if (mode === 'read') readCloses.push(close);
    else operationCloses.push(close);
    const providerScope = mode === 'read' ? readScope : operationScope;
    return {
      schemaVersion: 1,
      kind:
        mode === 'read'
          ? 'awsSingleNodeReadAuthority'
          : 'awsSingleNodeOperationAuthority',
      providerScope,
      api,
      resolveScope: async () => {
        events.push(`${mode}-scope`);
        return providerScope;
      },
      close,
    };
  }

  /**
   * @param {Readonly<Record<string, any>>} intent
   */
  function provisioningResult(intent) {
    return {
      schemaVersion: 1,
      kind: 'awsSingleNodeProvisioningResult',
      provisioningIntentId: intent.provisioningIntentId,
      planId: intent.plan.planId,
      providerSpecId: intent.plan.providerSpec.providerSpecId,
      desiredRevisionId: intent.plan.desired.desiredRevisionId,
      deploymentInstanceId: intent.plan.deploymentInstanceId,
      incarnationId: intent.incarnationId,
      resources: {
        securityGroupId: SECURITY_GROUP_ID,
        instanceId: INSTANCE_ID,
        rootVolumeId: VOLUME_ID,
      },
      publicIpv4: PUBLIC_IPV4,
      status: 'provisioned',
    };
  }

  const dependencies = {
    acquireOperationLock: async () => {
      events.push('lock');
      return release;
    },
    createReadAuthority: async () => {
      events.push('read-open');
      return authority('read');
    },
    createOperationAuthority: async () => {
      events.push('operation-open');
      return authority('operation');
    },
    resolvePlan: async () => {
      planCalls += 1;
      events.push('plan');
      return plan;
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
    convergeProvisioning: async (/** @type {Record<string, any>} */ value) => {
      convergeCalls += 1;
      events.push(`converge-${convergeCalls}`);
      recoveries.push({
        storedResourceIds: value.storedResourceIds,
        storedMutationAttempts: value.storedMutationAttempts,
      });
      const securityGroupAttempt = createAwsProvisioningMutationAttempt(
        value.intent,
        'securityGroup',
      );
      const instanceAttempt = createAwsProvisioningMutationAttempt(
        value.intent,
        'instance',
      );
      const rootVolumeAttempt = createAwsProvisioningMutationAttempt(
        value.intent,
        'rootVolume',
      );
      if (value.storedMutationAttempts.securityGroup === null) {
        mutationBatches.push(['securityGroup']);
        events.push('fence-securityGroup');
        await value.recordMutationAttempts([securityGroupAttempt]);
        if (
          options.crashStage === 'securityGroupPrepared' &&
          convergeCalls === 1
        ) {
          throw new Error('injected crash after security-group prepare');
        }
      }
      if (value.storedResourceIds.securityGroup === null) {
        events.push('resource-securityGroup');
        await value.recordResource(
          createAwsProvisionedResourceRecord(
            value.intent,
            'securityGroup',
            SECURITY_GROUP_ID,
          ),
        );
      }
      const instancePrepared = value.storedMutationAttempts.instance !== null;
      const rootVolumePrepared =
        value.storedMutationAttempts.rootVolume !== null;
      if (instancePrepared !== rootVolumePrepared) {
        throw new Error('test observed a non-atomic compute fence');
      }
      if (!instancePrepared) {
        mutationBatches.push(['instance', 'rootVolume']);
        events.push('fence-instance+rootVolume');
        await value.recordMutationAttempts([
          instanceAttempt,
          rootVolumeAttempt,
        ]);
        if (options.crashStage === 'computePrepared' && convergeCalls === 1) {
          throw new Error('injected crash after atomic compute prepare');
        }
      }
      if (value.storedResourceIds.instance === null) {
        events.push('resource-instance');
        await value.recordResource(
          createAwsProvisionedResourceRecord(
            value.intent,
            'instance',
            INSTANCE_ID,
          ),
        );
      }
      if (value.storedResourceIds.rootVolume === null) {
        events.push('resource-rootVolume');
        await value.recordResource(
          createAwsProvisionedResourceRecord(
            value.intent,
            'rootVolume',
            VOLUME_ID,
          ),
        );
      }
      return provisioningResult(value.intent);
    },
    verifyProvisioning: async (/** @type {Record<string, any>} */ value) => {
      verifyCalls += 1;
      events.push('verify');
      expect(value.api).toHaveProperty('describeInstanceCreditSpecifications');
      expect(value.api).not.toHaveProperty('createSecurityGroup');
      expect(value.api).not.toHaveProperty('authorizeSecurityGroupIngress');
      expect(value.api).not.toHaveProperty('runInstances');
      expect(value.storedResourceIds).toEqual({
        securityGroup: SECURITY_GROUP_ID,
        instance: INSTANCE_ID,
        rootVolume: VOLUME_ID,
      });
      return provisioningResult(value.intent);
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
      if (Object.hasOwn(value, 'artifactSource')) {
        await value.artifactSource.close();
      }
      return activationEvidence(
        value.desired,
        value.incarnationId,
        sshIdentity,
      );
    },
    randomBytes: jest.fn(() => Buffer.alloc(32, 31)),
    wait: async () => undefined,
  };
  return {
    fixture,
    dependencies,
    events,
    release,
    mutationBatches,
    recoveries,
    readCloses,
    operationCloses,
    getJournal: () => journal,
    getPlanCalls: () => planCalls,
    getConvergeCalls: () => convergeCalls,
    getVerifyCalls: () => verifyCalls,
    useWrongReadScope: () => {
      readScope = otherScope;
    },
    useWrongOperationScope: () => {
      operationScope = otherScope;
    },
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
      dataRoot: '/tmp/wharfie-aws-apply-test/data',
    },
    close,
  };
}

describe('AWS single-node apply coordinator', () => {
  it('durably fences creates before provisioning and reaches active state', async () => {
    const harness = await makeHarness();
    const source = makeSourceRequest(harness.fixture);
    const coordinator = createAwsSingleNodeApplyCoordinator(
      harness.dependencies,
    );

    const result = await coordinator.apply(source.request);
    const journal = /** @type {Readonly<Record<string, any>>} */ (
      harness.getJournal()
    );

    expect(result).toMatchObject({
      schemaVersion: AWS_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_APPLY_RESULT_KIND,
      provider: 'aws',
      status: 'active',
      deploymentInstanceId: harness.fixture.desired.deploymentInstanceId,
      desiredRevisionId: harness.fixture.desired.desiredRevisionId,
      publicIpv4: PUBLIC_IPV4,
      artifactId: harness.fixture.artifactRecord.artifactId,
    });
    expect(journal.phase).toBe('active');
    expect(journal.activation.activationEvidenceId).toBe(
      result.activationEvidenceId,
    );
    expect(harness.mutationBatches).toEqual([
      ['securityGroup'],
      ['instance', 'rootVolume'],
    ]);
    expect(harness.events.indexOf('read-scope')).toBeLessThan(
      harness.events.indexOf('plan'),
    );
    expect(harness.events.indexOf('read-close')).toBeLessThan(
      harness.events.indexOf('operation-open'),
    );
    expect(harness.events.indexOf('operation-scope')).toBeLessThan(
      harness.events.indexOf('journal-initialize'),
    );
    expect(harness.events.indexOf('journal-initialize')).toBeLessThan(
      harness.events.indexOf('fence-securityGroup'),
    );
    expect(harness.events.indexOf('fence-instance+rootVolume')).toBeLessThan(
      harness.events.indexOf('resource-instance'),
    );
    expect(harness.events.indexOf('host-key')).toBeLessThan(
      harness.events.indexOf('activate'),
    );
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(harness.release).toHaveBeenCalledTimes(1);
    expect(harness.readCloses[0]).toHaveBeenCalledTimes(1);
    expect(harness.operationCloses[0]).toHaveBeenCalledTimes(1);
  });

  it('resumes a prepared security-group create without minting new authority', async () => {
    const harness = await makeHarness({
      crashStage: 'securityGroupPrepared',
    });
    const coordinator = createAwsSingleNodeApplyCoordinator(
      harness.dependencies,
    );
    const first = makeSourceRequest(harness.fixture);

    await expect(coordinator.apply(first.request)).rejects.toThrow(
      'injected crash after security-group prepare',
    );
    const interrupted = /** @type {Readonly<Record<string, any>>} */ (
      harness.getJournal()
    );
    expect(interrupted.phase).toBe('provisioning');
    expect(interrupted.resources).toHaveLength(0);
    expect(interrupted.mutationAttempts).toMatchObject([
      { role: 'securityGroup', state: 'prepared' },
    ]);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(harness.operationCloses[0]).toHaveBeenCalledTimes(1);

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
    expect(harness.recoveries[1].storedResourceIds.securityGroup).toBeNull();
    expect(harness.recoveries[1].storedMutationAttempts.securityGroup).toEqual(
      interrupted.mutationAttempts[0].evidence,
    );
    expect(harness.mutationBatches).toEqual([
      ['securityGroup'],
      ['instance', 'rootVolume'],
    ]);
    expect(harness.getPlanCalls()).toBe(1);
    expect(harness.dependencies.randomBytes).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(harness.release).toHaveBeenCalledTimes(2);
  });

  it('resumes the atomic prepared instance and root-volume create', async () => {
    const harness = await makeHarness({ crashStage: 'computePrepared' });
    const coordinator = createAwsSingleNodeApplyCoordinator(
      harness.dependencies,
    );
    const first = makeSourceRequest(harness.fixture);

    await expect(coordinator.apply(first.request)).rejects.toThrow(
      'injected crash after atomic compute prepare',
    );
    const interrupted = /** @type {Readonly<Record<string, any>>} */ (
      harness.getJournal()
    );
    expect(interrupted.resources).toMatchObject([
      {
        role: 'securityGroup',
        providerResourceId: SECURITY_GROUP_ID,
        state: 'present',
      },
    ]);
    expect(
      interrupted.mutationAttempts
        .filter((/** @type {Record<string, any>} */ value) =>
          ['instance', 'rootVolume'].includes(value.role),
        )
        .map((/** @type {Record<string, any>} */ value) => ({
          role: value.role,
          state: value.state,
        })),
    ).toEqual([
      { role: 'instance', state: 'prepared' },
      { role: 'rootVolume', state: 'prepared' },
    ]);

    const second = makeSourceRequest(harness.fixture);
    await expect(coordinator.apply(second.request)).resolves.toMatchObject({
      status: 'active',
      incarnationId: interrupted.incarnationId,
    });

    expect(harness.recoveries[1].storedResourceIds).toEqual({
      securityGroup: SECURITY_GROUP_ID,
      instance: null,
      rootVolume: null,
    });
    expect(
      harness.recoveries[1].storedMutationAttempts.instance,
    ).not.toBeNull();
    expect(
      harness.recoveries[1].storedMutationAttempts.rootVolume,
    ).not.toBeNull();
    expect(harness.mutationBatches).toEqual([
      ['securityGroup'],
      ['instance', 'rootVolume'],
    ]);
    expect(harness.getConvergeCalls()).toBe(2);
    expect(harness.getPlanCalls()).toBe(1);
    expect(harness.dependencies.randomBytes).toHaveBeenCalledTimes(1);
  });

  it('uses read-only provider authority to verify and reactivate active state', async () => {
    const harness = await makeHarness();
    const coordinator = createAwsSingleNodeApplyCoordinator(
      harness.dependencies,
    );
    const first = makeSourceRequest(harness.fixture);
    const initial = await coordinator.apply(first.request);

    const second = makeSourceRequest(harness.fixture);
    const recovered = await coordinator.apply({
      desired: harness.fixture.desired,
      revision: harness.fixture.revision,
      artifactRecord: harness.fixture.artifactRecord,
      observation: harness.fixture.observation,
      artifactSource: second.request.artifactSource,
      dataRoot: second.request.dataRoot,
    });

    expect(recovered.journalId).toBe(initial.journalId);
    expect(harness.getPlanCalls()).toBe(1);
    expect(harness.getConvergeCalls()).toBe(1);
    expect(harness.getVerifyCalls()).toBe(1);
    expect(harness.operationCloses).toHaveLength(1);
    expect(harness.readCloses).toHaveLength(2);
    expect(harness.events.filter((event) => event === 'activate')).toHaveLength(
      2,
    );
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('rejects fresh credential drift before durable or provider effects', async () => {
    const harness = await makeHarness({
      operationAccountId: OTHER_ACCOUNT_ID,
    });
    const source = makeSourceRequest(harness.fixture);
    const coordinator = createAwsSingleNodeApplyCoordinator(
      harness.dependencies,
    );

    await expect(coordinator.apply(source.request)).rejects.toThrow(
      'ambient credentials do not match durable provider scope',
    );

    expect(harness.getJournal()).toBeNull();
    expect(harness.getConvergeCalls()).toBe(0);
    expect(harness.dependencies.randomBytes).not.toHaveBeenCalled();
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(harness.release).toHaveBeenCalledTimes(1);
    expect(harness.readCloses[0]).toHaveBeenCalledTimes(1);
    expect(harness.operationCloses[0]).toHaveBeenCalledTimes(1);
  });

  it('rejects recovery credential drift before verification or activation', async () => {
    const harness = await makeHarness();
    const coordinator = createAwsSingleNodeApplyCoordinator(
      harness.dependencies,
    );
    const first = makeSourceRequest(harness.fixture);
    await coordinator.apply(first.request);
    harness.useWrongReadScope();

    const second = makeSourceRequest(harness.fixture);
    await expect(coordinator.apply(second.request)).rejects.toThrow(
      'ambient credentials do not match durable provider scope',
    );

    expect(harness.getVerifyCalls()).toBe(0);
    expect(harness.events.filter((event) => event === 'activate')).toHaveLength(
      1,
    );
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(harness.release).toHaveBeenCalledTimes(2);
    expect(harness.readCloses.at(-1)).toHaveBeenCalledTimes(1);
  });
});
