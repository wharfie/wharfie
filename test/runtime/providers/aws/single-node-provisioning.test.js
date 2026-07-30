/* eslint-disable jsdoc/valid-types -- Explicit @this annotations verify that injected capabilities receive no authority-bearing receiver. */

import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../../../src/core/runtime/content-id.js';
import { createAwsProviderScope } from '../../../../src/core/runtime/deployment-provider-scope.js';
import { createAwsProvisioningMutationAttempt } from '../../../../src/core/runtime/providers/aws/single-node-journal-evidence.js';
import {
  AWS_SINGLE_NODE_PROVISIONING_DEADLINE_MS,
  AWS_SINGLE_NODE_PROVISIONING_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_PROVISIONING_RESULT_KIND,
  AWS_SINGLE_NODE_PROVISIONING_RESULT_SCHEMA_VERSION,
  AWS_SINGLE_NODE_PREPARED_CREATE_RECONCILIATION_RESULT_KIND,
  AwsSingleNodeProvisioningConflictError,
  AwsSingleNodeProvisioningTimeoutError,
  createAwsSingleNodeProvisioningConverger,
} from '../../../../src/core/runtime/providers/aws/single-node-provisioning.js';
import {
  AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
  createAwsSingleNodeResourceIdentity,
  createAwsSingleNodeRunInstancesClientToken,
} from '../../../../src/core/runtime/providers/aws/resource-identity.js';
import {
  AWS_SINGLE_NODE_PRIMARY_NETWORK_INTERFACE_DESCRIPTION,
  AWS_SINGLE_NODE_ROOT_VOLUME_IOPS,
  AWS_SINGLE_NODE_ROOT_VOLUME_THROUGHPUT,
} from '../../../../src/core/runtime/providers/aws/single-node-requests.js';
import {
  AWS_SINGLE_NODE_INSTANCE_TYPE,
  AWS_SINGLE_NODE_UBUNTU_PARAMETER,
  resolveAwsSingleNodePlan,
} from '../../../../src/core/runtime/providers/aws/single-node-plan.js';
import { createAwsSingleNodeProvisioningIntent } from '../../../../src/core/runtime/providers/aws/single-node-provisioning-intent.js';
import { SINGLE_NODE_CLOUD_INIT_MAX_BYTES } from '../../../../src/core/runtime/single-node-cloud-init.js';
import { createSingleNodeDeploymentDesired } from '../../../../src/core/runtime/single-node-deployment-desired.js';
import { createSingleNodeDeploymentIncarnationId } from '../../../../src/core/runtime/single-node-deployment-identity.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../../../../src/core/runtime/single-node-deployment-intent.js';

const REGION = 'us-east-2';
const ACCOUNT_ID = '123456789012';
const VPC_ID = 'vpc-0123456789abcdef0';
const SUBNET_ID = 'subnet-0123456789abcdef0';
const ROUTE_TABLE_ID = 'rtb-0123456789abcdef0';
const INTERNET_GATEWAY_ID = 'igw-0123456789abcdef0';
const NETWORK_ACL_ID = 'acl-0123456789abcdef0';
const NETWORK_ACL_ASSOCIATION_ID = 'aclassoc-0123456789abcdef0';
const AMI_ID = 'ami-0123456789abcdef0';
const SNAPSHOT_ID = 'snap-0123456789abcdef0';
const SECURITY_GROUP_ID = 'sg-0123456789abcdef0';
const RESPONSE_SECURITY_GROUP_ID = 'sg-1123456789abcdef0';
const INSTANCE_ID = 'i-0123456789abcdef0';
const RESPONSE_INSTANCE_ID = 'i-1123456789abcdef0';
const VOLUME_ID = 'vol-0123456789abcdef0';
const NETWORK_INTERFACE_ID = 'eni-0123456789abcdef0';
const PUBLIC_IPV4 = '203.0.113.40';
const CLOUD_INIT_BYTES = Buffer.from('#cloud-config\n');
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/** @type {Readonly<Record<string, any>>} */
let plan;
/** @type {Readonly<Record<string, any>>} */
let provisioningIntent;
/** @type {Readonly<Record<string, any>>} */
let identities;

beforeAll(async () => {
  plan = await resolveAwsSingleNodePlan({
    desired: makeDesired(),
    providerScope: createAwsProviderScope({
      partition: 'aws',
      accountId: ACCOUNT_ID,
      region: REGION,
    }),
    api: makePlanApi(),
  });
  provisioningIntent = makeProvisioningIntent(CLOUD_INIT_BYTES);
  identities = {
    securityGroup: createAwsSingleNodeResourceIdentity(
      provisioningIntent,
      'securityGroup',
    ),
    instance: createAwsSingleNodeResourceIdentity(
      provisioningIntent,
      'instance',
    ),
    rootVolume: createAwsSingleNodeResourceIdentity(
      provisioningIntent,
      'rootVolume',
    ),
  };
});

/** @param {string|Buffer|Uint8Array} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {any} value @returns {boolean} */
function deeplyFrozen(value) {
  return (
    value === null ||
    typeof value !== 'object' ||
    (Object.isFrozen(value) && Object.values(value).every(deeplyFrozen))
  );
}

/** @param {Buffer|Uint8Array} bytes */
function makeProvisioningIntent(bytes) {
  return createAwsSingleNodeProvisioningIntent({
    plan,
    incarnationId: createSingleNodeDeploymentIncarnationId(
      Buffer.alloc(32, 51),
    ),
    cloudInitDigest: digest(bytes),
  });
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
  const artifactRecord = createArtifactRecord({
    bytes: Buffer.from('exact Linux SEA payload'),
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
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function securityGroup(overrides = {}) {
  return {
    GroupId: SECURITY_GROUP_ID,
    OwnerId: ACCOUNT_ID,
    VpcId: VPC_ID,
    GroupName: identities.securityGroup.name,
    Description: AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
    Tags: clone(identities.securityGroup.tags),
    IpPermissions: [
      {
        IpProtocol: 'tcp',
        FromPort: 22,
        ToPort: 22,
        IpRanges: provisioningIntent.plan.desired.intent.access.allowedIpv4.map(
          (/** @type {string} */ CidrIp) => ({ CidrIp }),
        ),
      },
    ],
    IpPermissionsEgress: [
      {
        IpProtocol: '-1',
        IpRanges: [{ CidrIp: '0.0.0.0/0' }],
        Ipv6Ranges: [{ CidrIpv6: '::/0' }],
      },
    ],
    ...overrides,
  };
}

function partialSecurityGroup() {
  return securityGroup({
    IpPermissions: [
      {
        IpProtocol: 'tcp',
        FromPort: 22,
        ToPort: 22,
        IpRanges: [{ CidrIp: '203.0.113.7/32' }],
      },
    ],
  });
}

/**
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function instance(overrides = {}) {
  const groupName = identities.securityGroup.name;
  return {
    InstanceId: INSTANCE_ID,
    ClientToken: createAwsSingleNodeRunInstancesClientToken(provisioningIntent),
    ImageId: AMI_ID,
    InstanceType: 't3.small',
    VpcId: VPC_ID,
    SubnetId: SUBNET_ID,
    Architecture: 'x86_64',
    RootDeviceType: 'ebs',
    RootDeviceName: '/dev/sda1',
    VirtualizationType: 'hvm',
    EnaSupport: true,
    EbsOptimized: true,
    Monitoring: { State: 'disabled' },
    HibernationOptions: { Configured: false },
    EnclaveOptions: { Enabled: false },
    Placement: { AvailabilityZone: 'us-east-2a', Tenancy: 'default' },
    State: { Name: 'running' },
    SecurityGroups: [{ GroupId: SECURITY_GROUP_ID, GroupName: groupName }],
    Tags: clone(identities.instance.tags),
    MetadataOptions: {
      State: 'applied',
      HttpEndpoint: 'enabled',
      HttpTokens: 'required',
      HttpPutResponseHopLimit: 1,
      HttpProtocolIpv6: 'disabled',
      InstanceMetadataTags: 'disabled',
    },
    NetworkInterfaces: [
      {
        NetworkInterfaceId: NETWORK_INTERFACE_ID,
        Description: AWS_SINGLE_NODE_PRIMARY_NETWORK_INTERFACE_DESCRIPTION,
        InterfaceType: 'interface',
        SubnetId: SUBNET_ID,
        VpcId: VPC_ID,
        Groups: [{ GroupId: SECURITY_GROUP_ID, GroupName: groupName }],
        Ipv6Addresses: [],
        Attachment: {
          DeviceIndex: 0,
          NetworkCardIndex: 0,
          DeleteOnTermination: true,
          Status: 'attached',
        },
        Association: { PublicIp: PUBLIC_IPV4 },
      },
    ],
    PublicIpAddress: PUBLIC_IPV4,
    BlockDeviceMappings: [
      {
        DeviceName: '/dev/sda1',
        Ebs: {
          VolumeId: VOLUME_ID,
          DeleteOnTermination: true,
          Status: 'attached',
        },
      },
    ],
    ...overrides,
  };
}

function settlingInstance() {
  return instance({
    State: { Name: 'pending' },
    MetadataOptions: { ...instance().MetadataOptions, State: 'pending' },
  });
}

/**
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function volume(overrides = {}) {
  return {
    VolumeId: VOLUME_ID,
    AvailabilityZone: 'us-east-2a',
    SnapshotId: SNAPSHOT_ID,
    VolumeType: 'gp3',
    Size: 8,
    Iops: AWS_SINGLE_NODE_ROOT_VOLUME_IOPS,
    Throughput: AWS_SINGLE_NODE_ROOT_VOLUME_THROUGHPUT,
    Encrypted: true,
    MultiAttachEnabled: false,
    State: 'in-use',
    Tags: clone(identities.rootVolume.tags),
    Attachments: [
      {
        InstanceId: INSTANCE_ID,
        VolumeId: VOLUME_ID,
        Device: '/dev/sda1',
        DeleteOnTermination: true,
        State: 'attached',
      },
    ],
    ...overrides,
  };
}

function exactCreditResponse() {
  return {
    InstanceCreditSpecifications: [
      { InstanceId: INSTANCE_ID, CpuCredits: 'standard' },
    ],
  };
}

/**
 * @param {Record<string, any>} request
 * @param {Record<string, any>} [values]
 */
function exactAttributeResponse(request, values = {}) {
  let responseKey;
  let expectedValue;
  switch (request.Attribute) {
    case 'disableApiStop':
      responseKey = 'DisableApiStop';
      expectedValue = false;
      break;
    case 'disableApiTermination':
      responseKey = 'DisableApiTermination';
      expectedValue = false;
      break;
    case 'instanceInitiatedShutdownBehavior':
      responseKey = 'InstanceInitiatedShutdownBehavior';
      expectedValue = 'stop';
      break;
    default:
      throw new Error('unsupported test attribute');
  }
  const value = Object.hasOwn(values, request.Attribute)
    ? values[request.Attribute]
    : expectedValue;
  return {
    $metadata: { httpStatusCode: 200 },
    InstanceId: request.InstanceId,
    [responseKey]: { Value: value },
  };
}

function emptyRecoveryIds() {
  return { securityGroup: null, instance: null, rootVolume: null };
}

function emptyRecoveryAttempts() {
  return { securityGroup: null, instance: null, rootVolume: null };
}

function allAttempts() {
  return {
    securityGroup: createAwsProvisioningMutationAttempt(
      provisioningIntent,
      'securityGroup',
    ),
    instance: createAwsProvisioningMutationAttempt(
      provisioningIntent,
      'instance',
    ),
    rootVolume: createAwsProvisioningMutationAttempt(
      provisioningIntent,
      'rootVolume',
    ),
  };
}

function allIds() {
  return {
    securityGroup: SECURITY_GROUP_ID,
    instance: INSTANCE_ID,
    rootVolume: VOLUME_ID,
  };
}

/**
 * @typedef {{
 *   securityGroup?: string,
 *   instance?: string,
 *   volume?: string,
 *   createSecurityGroupTargets?: string[],
 *   runInstancesTargets?: string[],
 *   throwCreateSecurityGroup?: boolean,
 *   throwRunInstances?: boolean,
 *   onRecordMutationAttempts?: (records: any[]) => void,
 * }} HarnessOptions
 */

/**
 * @param {HarnessOptions} [options]
 */
function makeHarness(options = {}) {
  let securityGroupState = options.securityGroup ?? 'absent';
  let instanceState = options.instance ?? 'absent';
  let volumeState = options.volume ?? 'absent';
  let createSecurityGroupCall = 0;
  let runInstancesCall = 0;
  /** @type {Array<Record<string, any>>} */
  const events = [];
  /** @type {unknown[]} */
  const apiReceivers = [];
  /** @type {unknown[]} */
  const callbackReceivers = [];

  function observedSecurityGroup() {
    if (securityGroupState === 'absent') return null;
    if (securityGroupState === 'partial') return partialSecurityGroup();
    if (securityGroupState === 'spec-conflict') {
      return securityGroup({ Description: 'unexpected description' });
    }
    if (securityGroupState === 'scope-conflict') {
      return securityGroup({ OwnerId: '999999999999' });
    }
    if (securityGroupState === 'ownership-conflict') {
      const Tags = clone(identities.securityGroup.tags);
      Tags[0].Value = 'wrong-owned-value';
      return securityGroup({ Tags });
    }
    return securityGroup();
  }

  function observedInstance() {
    if (instanceState === 'absent') return null;
    if (instanceState === 'settling') return settlingInstance();
    if (instanceState === 'terminal') {
      return instance({ State: { Name: 'terminated' } });
    }
    return instance();
  }

  function observedVolume() {
    if (volumeState === 'absent') return null;
    if (volumeState === 'settling') {
      return volume({ State: 'creating', Attachments: [] });
    }
    if (volumeState === 'spec-conflict') return volume({ Iops: 6000 });
    if (volumeState === 'unexpected-attachment') {
      return volume({
        Attachments: [
          {
            ...volume().Attachments[0],
            InstanceId: RESPONSE_INSTANCE_ID,
          },
        ],
      });
    }
    return volume();
  }

  const api = {
    describeSecurityGroups: jest.fn(
      /** @this {unknown} */
      async function () {
        apiReceivers.push(this);
        const observed = observedSecurityGroup();
        return { SecurityGroups: observed === null ? [] : [observed] };
      },
    ),
    describeInstances: jest.fn(
      /** @this {unknown} */
      async function () {
        apiReceivers.push(this);
        const observed = observedInstance();
        return {
          Reservations:
            observed === null
              ? []
              : [
                  {
                    ReservationId: 'r-0123456789abcdef0',
                    OwnerId: ACCOUNT_ID,
                    Instances: [observed],
                  },
                ],
        };
      },
    ),
    describeVolumes: jest.fn(
      /** @this {unknown} */
      async function () {
        apiReceivers.push(this);
        const observed = observedVolume();
        return { Volumes: observed === null ? [] : [observed] };
      },
    ),
    describeInstanceAttribute: jest.fn(
      /** @this {unknown} @param {Record<string, any>} request */
      async function (request) {
        apiReceivers.push(this);
        return exactAttributeResponse(
          request,
          instanceState === 'spec-conflict'
            ? { disableApiTermination: true }
            : {},
        );
      },
    ),
    describeInstanceCreditSpecifications: jest.fn(
      /** @this {unknown} */
      async function () {
        apiReceivers.push(this);
        return instanceState === 'absent'
          ? { InstanceCreditSpecifications: [] }
          : exactCreditResponse();
      },
    ),
    createSecurityGroup: jest.fn(
      /** @this {unknown} @param {Record<string, any>} request */
      async function (request) {
        apiReceivers.push(this);
        events.push({ type: 'createSecurityGroup', request });
        const targets = options.createSecurityGroupTargets ?? ['partial'];
        securityGroupState =
          targets[Math.min(createSecurityGroupCall, targets.length - 1)];
        createSecurityGroupCall += 1;
        if (options.throwCreateSecurityGroup) {
          throw new Error('provider credential sentinel');
        }
        return { GroupId: RESPONSE_SECURITY_GROUP_ID };
      },
    ),
    authorizeSecurityGroupIngress: jest.fn(
      /** @this {unknown} @param {Record<string, any>} request */
      async function (request) {
        apiReceivers.push(this);
        events.push({ type: 'authorizeSecurityGroupIngress', request });
        securityGroupState = 'exact';
        return { Return: true };
      },
    ),
    runInstances: jest.fn(
      /** @this {unknown} @param {Record<string, any>} request */
      async function (request) {
        apiReceivers.push(this);
        events.push({ type: 'runInstances', request });
        const targets = options.runInstancesTargets ?? ['exact'];
        const target = targets[Math.min(runInstancesCall, targets.length - 1)];
        runInstancesCall += 1;
        if (target !== 'absent') {
          instanceState = target === 'settling' ? 'settling' : target;
          volumeState = target === 'settling' ? 'settling' : 'exact';
        }
        if (options.throwRunInstances) {
          throw new Error('provider credential sentinel');
        }
        return { Instances: [{ InstanceId: RESPONSE_INSTANCE_ID }] };
      },
    ),
  };

  const callbacks = {
    recordMutationAttempts: jest.fn(
      /** @this {unknown} @param {any[]} records */
      async function (records) {
        callbackReceivers.push(this);
        events.push({
          type: 'recordMutationAttempts',
          roles: records.map((record) => record.role),
          records,
        });
        options.onRecordMutationAttempts?.(records);
      },
    ),
    recordResource: jest.fn(
      /** @this {unknown} @param {Record<string, any>} record */
      async function (record) {
        callbackReceivers.push(this);
        events.push({
          type: 'recordResource',
          role: record.role,
          id: record.providerResourceId,
          record,
        });
      },
    ),
  };

  return {
    api,
    callbacks,
    events,
    apiReceivers,
    callbackReceivers,
    setExactCompute() {
      instanceState = 'exact';
      volumeState = 'exact';
    },
  };
}

/**
 * @param {(() => void|Promise<void>)} [onSleep]
 */
function makeTestConverger(onSleep = () => {}) {
  let milliseconds = 0;
  const sleep = jest.fn(async (/** @type {number} */ delay) => {
    milliseconds += delay;
    await onSleep();
  });
  return {
    converger: createAwsSingleNodeProvisioningConverger({
      now: () => milliseconds,
      sleep,
    }),
    sleep,
    setTime(/** @type {number} */ value) {
      milliseconds = value;
    },
  };
}

/**
 * @param {ReturnType<typeof makeHarness>} harness
 * @param {Record<string, any>} [overrides]
 */
function convergenceInput(harness, overrides = {}) {
  return {
    intent: provisioningIntent,
    cloudInitBytes: CLOUD_INIT_BYTES,
    storedResourceIds: emptyRecoveryIds(),
    storedMutationAttempts: emptyRecoveryAttempts(),
    api: harness.api,
    recordMutationAttempts: harness.callbacks.recordMutationAttempts,
    recordResource: harness.callbacks.recordResource,
    ...overrides,
  };
}

/**
 * @param {ReturnType<typeof makeHarness>} harness
 * @param {Record<string, any>} [overrides]
 */
function verificationInput(harness, overrides = {}) {
  return {
    intent: provisioningIntent,
    storedResourceIds: allIds(),
    storedMutationAttempts: allAttempts(),
    api: harness.api,
    ...overrides,
  };
}

describe('AWS single-node provisioning convergence', () => {
  it('fences before mutation, records the compute pair atomically, and trusts only readback IDs', async () => {
    const harness = makeHarness();
    const { converger } = makeTestConverger();

    const result = await converger.converge(convergenceInput(harness));

    expect(
      harness.events.map((event) =>
        event.type === 'recordMutationAttempts'
          ? `${event.type}:${event.roles.join('+')}`
          : event.type === 'recordResource'
            ? `${event.type}:${event.role}`
            : event.type,
      ),
    ).toEqual([
      'recordMutationAttempts:securityGroup',
      'createSecurityGroup',
      'authorizeSecurityGroupIngress',
      'recordResource:securityGroup',
      'recordMutationAttempts:instance+rootVolume',
      'runInstances',
      'recordResource:instance',
      'recordResource:rootVolume',
    ]);
    expect(
      harness.callbacks.recordMutationAttempts.mock.calls[1][0].map(
        (/** @type {Record<string, any>} */ record) => record.role,
      ),
    ).toEqual(['instance', 'rootVolume']);
    expect(
      harness.events.find(
        (event) => event.type === 'authorizeSecurityGroupIngress',
      )?.request.IpPermissions[0].IpRanges,
    ).toEqual([{ CidrIp: '203.0.113.9/32' }]);
    expect(
      harness.events.find((event) => event.type === 'runInstances')?.request
        .UserData,
    ).toBe(CLOUD_INIT_BYTES.toString('base64'));
    expect(result).toEqual({
      schemaVersion: AWS_SINGLE_NODE_PROVISIONING_RESULT_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_PROVISIONING_RESULT_KIND,
      provisioningIntentId: provisioningIntent.provisioningIntentId,
      planId: provisioningIntent.plan.planId,
      providerSpecId: provisioningIntent.plan.providerSpec.providerSpecId,
      desiredRevisionId: provisioningIntent.plan.desired.desiredRevisionId,
      deploymentInstanceId: provisioningIntent.plan.deploymentInstanceId,
      incarnationId: provisioningIntent.incarnationId,
      resources: {
        securityGroupId: SECURITY_GROUP_ID,
        instanceId: INSTANCE_ID,
        rootVolumeId: VOLUME_ID,
      },
      publicIpv4: PUBLIC_IPV4,
      status: 'provisioned',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /credential|secret|access.key/iu,
    );
    expect(deeplyFrozen(result)).toBe(true);
    expect(
      harness.apiReceivers.every((receiver) => receiver === undefined),
    ).toBe(true);
    expect(
      harness.callbackReceivers.every((receiver) => receiver === undefined),
    ).toBe(true);
  });

  it('recovers lost create responses, partial ingress, and settling compute through readback', async () => {
    const harness = makeHarness({
      throwCreateSecurityGroup: true,
      throwRunInstances: true,
      runInstancesTargets: ['settling'],
    });
    const { converger, sleep } = makeTestConverger(() => {
      harness.setExactCompute();
    });

    await expect(
      converger.converge(convergenceInput(harness)),
    ).resolves.toMatchObject({
      status: 'provisioned',
      resources: {
        securityGroupId: SECURITY_GROUP_ID,
        instanceId: INSTANCE_ID,
        rootVolumeId: VOLUME_ID,
      },
    });
    expect(harness.api.createSecurityGroup).toHaveBeenCalledTimes(1);
    expect(harness.api.authorizeSecurityGroupIngress).toHaveBeenCalledTimes(1);
    expect(harness.api.runInstances).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalled();
  });

  it('replays identical deterministic requests after readback still proves absence', async () => {
    const harness = makeHarness({
      createSecurityGroupTargets: ['absent', 'partial'],
      runInstancesTargets: ['absent', 'exact'],
      throwCreateSecurityGroup: true,
      throwRunInstances: true,
    });
    const { converger } = makeTestConverger();

    await converger.converge(
      convergenceInput(harness, {
        storedMutationAttempts: allAttempts(),
      }),
    );

    expect(harness.api.createSecurityGroup).toHaveBeenCalledTimes(2);
    expect(harness.api.runInstances).toHaveBeenCalledTimes(2);
    const createRequests = harness.events
      .filter((event) => event.type === 'createSecurityGroup')
      .map((event) => event.request);
    const runRequests = harness.events
      .filter((event) => event.type === 'runInstances')
      .map((event) => event.request);
    expect(createRequests[1]).toEqual(createRequests[0]);
    expect(runRequests[1]).toEqual(runRequests[0]);
    expect(runRequests[1].ClientToken).toBe(runRequests[0].ClientToken);
    expect(harness.callbacks.recordMutationAttempts).not.toHaveBeenCalled();
  });

  it('recovers exact stored resources without any mutation or duplicate record', async () => {
    const harness = makeHarness({
      securityGroup: 'exact',
      instance: 'exact',
      volume: 'exact',
    });
    const { converger } = makeTestConverger();

    const result = await converger.converge(
      convergenceInput(harness, {
        storedResourceIds: allIds(),
        storedMutationAttempts: allAttempts(),
      }),
    );

    expect(result.resources).toEqual({
      securityGroupId: SECURITY_GROUP_ID,
      instanceId: INSTANCE_ID,
      rootVolumeId: VOLUME_ID,
    });
    expect(harness.api.createSecurityGroup).not.toHaveBeenCalled();
    expect(harness.api.authorizeSecurityGroupIngress).not.toHaveBeenCalled();
    expect(harness.api.runInstances).not.toHaveBeenCalled();
    expect(harness.callbacks.recordMutationAttempts).not.toHaveBeenCalled();
    expect(harness.callbacks.recordResource).not.toHaveBeenCalled();
  });

  it('refuses adoption without durable create authority and rejects a partial compute fence', async () => {
    const exactGroup = makeHarness({ securityGroup: 'exact' });
    const { converger } = makeTestConverger();
    await expect(
      converger.converge(convergenceInput(exactGroup)),
    ).rejects.toMatchObject({
      code: 'AWS_SINGLE_NODE_PROVISIONING_CONFLICT',
      stage: 'securityGroup',
    });
    expect(exactGroup.api.createSecurityGroup).not.toHaveBeenCalled();

    const exactCompute = makeHarness({
      securityGroup: 'exact',
      instance: 'exact',
      volume: 'exact',
    });
    await expect(
      converger.converge(
        convergenceInput(exactCompute, {
          storedResourceIds: {
            securityGroup: SECURITY_GROUP_ID,
            instance: null,
            rootVolume: null,
          },
          storedMutationAttempts: {
            securityGroup: allAttempts().securityGroup,
            instance: null,
            rootVolume: null,
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'AWS_SINGLE_NODE_PROVISIONING_CONFLICT',
      stage: 'instance',
    });
    expect(exactCompute.api.runInstances).not.toHaveBeenCalled();

    const partialPair = makeHarness();
    await expect(
      converger.converge(
        convergenceInput(partialPair, {
          storedMutationAttempts: {
            securityGroup: null,
            instance: allAttempts().instance,
            rootVolume: null,
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'AWS_SINGLE_NODE_PROVISIONING_CONFLICT',
      stage: 'recovery',
    });
    expect(partialPair.api.describeSecurityGroups).not.toHaveBeenCalled();

    const computeWithoutGroup = makeHarness();
    await expect(
      converger.converge(
        convergenceInput(computeWithoutGroup, {
          storedMutationAttempts: {
            securityGroup: null,
            instance: allAttempts().instance,
            rootVolume: allAttempts().rootVolume,
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'AWS_SINGLE_NODE_PROVISIONING_CONFLICT',
      stage: 'recovery',
    });
    expect(
      computeWithoutGroup.api.describeSecurityGroups,
    ).not.toHaveBeenCalled();
  });

  it.each(['scope-conflict', 'ownership-conflict', 'spec-conflict'])(
    'stops safely on security-group %s evidence',
    async (securityGroupState) => {
      const harness = makeHarness({ securityGroup: securityGroupState });
      const { converger } = makeTestConverger();
      await expect(
        converger.converge(
          convergenceInput(harness, {
            storedMutationAttempts: {
              ...emptyRecoveryAttempts(),
              securityGroup: allAttempts().securityGroup,
            },
          }),
        ),
      ).rejects.toBeInstanceOf(AwsSingleNodeProvisioningConflictError);
      expect(harness.api.createSecurityGroup).not.toHaveBeenCalled();
      expect(harness.api.authorizeSecurityGroupIngress).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['terminal instance', 'terminal', 'exact'],
    ['instance spec drift', 'spec-conflict', 'exact'],
    ['root-volume spec drift', 'exact', 'spec-conflict'],
    ['unexpected root attachment', 'exact', 'unexpected-attachment'],
  ])('stops safely on %s', async (_label, instanceState, volumeState) => {
    const harness = makeHarness({
      securityGroup: 'exact',
      instance: instanceState,
      volume: volumeState,
    });
    const { converger } = makeTestConverger();
    await expect(
      converger.converge(
        convergenceInput(harness, {
          storedResourceIds: {
            securityGroup: SECURITY_GROUP_ID,
            instance: null,
            rootVolume: null,
          },
          storedMutationAttempts: allAttempts(),
        }),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeProvisioningConflictError);
    expect(harness.callbacks.recordResource).not.toHaveBeenCalledWith(
      expect.objectContaining({ role: 'instance' }),
    );
  });

  it('times out with fixed sanitized evidence while deterministic replay remains bounded', async () => {
    const harness = makeHarness({
      createSecurityGroupTargets: ['absent'],
      throwCreateSecurityGroup: true,
    });
    const { converger } = makeTestConverger();

    let thrown;
    try {
      await converger.converge(
        convergenceInput(harness, {
          storedMutationAttempts: {
            ...emptyRecoveryAttempts(),
            securityGroup: allAttempts().securityGroup,
          },
        }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AwsSingleNodeProvisioningTimeoutError);
    expect(thrown).toMatchObject({
      code: 'AWS_SINGLE_NODE_PROVISIONING_TIMEOUT',
      stage: 'securityGroup',
    });
    expect(String(thrown)).not.toContain('provider credential sentinel');
    expect(harness.api.createSecurityGroup.mock.calls.length).toBeGreaterThan(
      1,
    );
    expect(harness.api.createSecurityGroup.mock.calls.length).toBeLessThan(
      AWS_SINGLE_NODE_PROVISIONING_MAX_ATTEMPTS,
    );
    expect(AWS_SINGLE_NODE_PROVISIONING_DEADLINE_MS).toBeGreaterThan(0);
  });

  it('snapshots cloud-init before the first await and enforces digest and size', async () => {
    const callerBytes = Buffer.from(CLOUD_INIT_BYTES);
    const harness = makeHarness({
      onRecordMutationAttempts() {
        callerBytes.fill(0);
      },
    });
    const { converger } = makeTestConverger();
    await converger.converge(
      convergenceInput(harness, { cloudInitBytes: callerBytes }),
    );
    expect(
      harness.events.find((event) => event.type === 'runInstances')?.request
        .UserData,
    ).toBe(CLOUD_INIT_BYTES.toString('base64'));

    const invalidHarness = makeHarness();
    await expect(
      converger.converge(
        convergenceInput(invalidHarness, {
          cloudInitBytes: Buffer.from('wrong bytes'),
        }),
      ),
    ).rejects.toThrow(/persisted digest/iu);
    await expect(
      converger.converge(
        convergenceInput(invalidHarness, {
          cloudInitBytes: Buffer.alloc(0),
        }),
      ),
    ).rejects.toThrow(RangeError);
    const oversized = Buffer.alloc(SINGLE_NODE_CLOUD_INIT_MAX_BYTES + 1);
    await expect(
      converger.converge(
        convergenceInput(invalidHarness, {
          intent: makeProvisioningIntent(oversized),
          cloudInitBytes: oversized,
        }),
      ),
    ).rejects.toThrow(RangeError);
    expect(invalidHarness.api.describeSecurityGroups).not.toHaveBeenCalled();
  });

  it('verifies exact resources without inspecting or invoking mutation powers', async () => {
    const harness = makeHarness({
      securityGroup: 'exact',
      instance: 'exact',
      volume: 'exact',
    });
    let mutationAccessorRead = false;
    const api = { ...harness.api };
    Object.defineProperty(api, 'createSecurityGroup', {
      enumerable: true,
      get() {
        mutationAccessorRead = true;
        throw new Error('must not inspect mutation');
      },
    });
    const { converger } = makeTestConverger();

    const result = await converger.verify(verificationInput(harness, { api }));

    expect(result.status).toBe('provisioned');
    expect(mutationAccessorRead).toBe(false);
    expect(harness.api.createSecurityGroup).not.toHaveBeenCalled();
    expect(harness.api.authorizeSecurityGroupIngress).not.toHaveBeenCalled();
    expect(harness.api.runInstances).not.toHaveBeenCalled();

    const absent = makeHarness();
    await expect(
      converger.verify(
        verificationInput(absent, {
          storedResourceIds: emptyRecoveryIds(),
        }),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeProvisioningConflictError);
    expect(absent.api.createSecurityGroup).not.toHaveBeenCalled();
    expect(absent.api.authorizeSecurityGroupIngress).not.toHaveBeenCalled();
    expect(absent.api.runInstances).not.toHaveBeenCalled();
  });

  it('rejects accessor-bearing options without invoking them', async () => {
    const harness = makeHarness();
    const input = convergenceInput(harness);
    let read = false;
    Object.defineProperty(input, 'intent', {
      enumerable: true,
      get() {
        read = true;
        return provisioningIntent;
      },
    });
    const { converger } = makeTestConverger();
    await expect(converger.converge(input)).rejects.toThrow(/own data field/iu);
    expect(read).toBe(false);
    expect(harness.api.describeSecurityGroups).not.toHaveBeenCalled();
  });
});

describe('AWS prepared-create reconciliation for destroy', () => {
  it('replays only fenced creates and records owned IDs without requiring active exact spec', async () => {
    const harness = makeHarness({
      createSecurityGroupTargets: ['spec-conflict'],
      runInstancesTargets: ['spec-conflict'],
      throwCreateSecurityGroup: true,
      throwRunInstances: true,
    });
    const { converger } = makeTestConverger();

    const result = await converger.reconcilePreparedCreatesForDestroy(
      convergenceInput(harness, {
        storedMutationAttempts: allAttempts(),
      }),
    );

    expect(result).toEqual({
      schemaVersion: 1,
      kind: AWS_SINGLE_NODE_PREPARED_CREATE_RECONCILIATION_RESULT_KIND,
      provisioningIntentId: provisioningIntent.provisioningIntentId,
      planId: provisioningIntent.plan.planId,
      deploymentInstanceId: provisioningIntent.plan.deploymentInstanceId,
      incarnationId: provisioningIntent.incarnationId,
      resources: {
        securityGroupId: SECURITY_GROUP_ID,
        instanceId: INSTANCE_ID,
        rootVolumeId: VOLUME_ID,
      },
      status: 'reconciled',
    });
    expect(harness.api.createSecurityGroup).toHaveBeenCalledTimes(1);
    expect(harness.api.authorizeSecurityGroupIngress).not.toHaveBeenCalled();
    expect(harness.api.runInstances).toHaveBeenCalledTimes(1);
    expect(harness.callbacks.recordMutationAttempts).not.toHaveBeenCalled();
    expect(
      harness.callbacks.recordResource.mock.calls.map((call) => call[0].role),
    ).toEqual(['securityGroup', 'instance', 'rootVolume']);
    expect(
      harness.events.find((event) => event.type === 'runInstances')?.request
        .UserData,
    ).toBe(CLOUD_INIT_BYTES.toString('base64'));
    expect(deeplyFrozen(result)).toBe(true);
  });

  it('does not create unattempted absent roles and rejects unsafe attachment recovery', async () => {
    const absent = makeHarness();
    const { converger } = makeTestConverger();
    await expect(
      converger.reconcilePreparedCreatesForDestroy(
        convergenceInput(absent, { cloudInitBytes: null }),
      ),
    ).resolves.toMatchObject({
      resources: {
        securityGroupId: null,
        instanceId: null,
        rootVolumeId: null,
      },
      status: 'reconciled',
    });
    expect(absent.api.createSecurityGroup).not.toHaveBeenCalled();
    expect(absent.api.runInstances).not.toHaveBeenCalled();

    const securityGroupOnly = makeHarness({
      createSecurityGroupTargets: ['spec-conflict'],
    });
    await expect(
      converger.reconcilePreparedCreatesForDestroy(
        convergenceInput(securityGroupOnly, {
          cloudInitBytes: null,
          storedMutationAttempts: {
            ...emptyRecoveryAttempts(),
            securityGroup: allAttempts().securityGroup,
          },
        }),
      ),
    ).resolves.toMatchObject({
      resources: {
        securityGroupId: SECURITY_GROUP_ID,
        instanceId: null,
        rootVolumeId: null,
      },
    });
    expect(securityGroupOnly.api.createSecurityGroup).toHaveBeenCalledTimes(1);
    expect(securityGroupOnly.api.runInstances).not.toHaveBeenCalled();

    const computeWithoutBytes = makeHarness();
    await expect(
      converger.reconcilePreparedCreatesForDestroy(
        convergenceInput(computeWithoutBytes, {
          cloudInitBytes: null,
          storedMutationAttempts: allAttempts(),
        }),
      ),
    ).rejects.toThrow(/must be bytes/iu);
    expect(
      computeWithoutBytes.api.describeSecurityGroups,
    ).not.toHaveBeenCalled();

    const unsafe = makeHarness({
      securityGroup: 'exact',
      instance: 'exact',
      volume: 'unexpected-attachment',
    });
    await expect(
      converger.reconcilePreparedCreatesForDestroy(
        convergenceInput(unsafe, {
          storedResourceIds: {
            securityGroup: SECURITY_GROUP_ID,
            instance: null,
            rootVolume: null,
          },
          storedMutationAttempts: allAttempts(),
        }),
      ),
    ).rejects.toMatchObject({
      code: 'AWS_SINGLE_NODE_PROVISIONING_CONFLICT',
      stage: 'rootVolume',
    });
    expect(unsafe.callbacks.recordResource).not.toHaveBeenCalledWith(
      expect.objectContaining({ role: 'rootVolume' }),
    );
  });
});
