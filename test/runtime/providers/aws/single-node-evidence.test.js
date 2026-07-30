import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../../../src/core/runtime/content-id.js';
import { createAwsProviderScope } from '../../../../src/core/runtime/deployment-provider-scope.js';
import {
  AwsSingleNodeEvidenceConflictError,
  AwsSingleNodeEvidenceTransientError,
  AwsSingleNodeEvidenceUnknownError,
  inspectAwsSingleNodeInstance,
  inspectAwsSingleNodeRootVolume,
  inspectAwsSingleNodeSecurityGroup,
} from '../../../../src/core/runtime/providers/aws/single-node-evidence.js';
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
  resolveAwsSingleNodePlan,
} from '../../../../src/core/runtime/providers/aws/single-node-plan.js';
import { createAwsSingleNodeProvisioningIntent } from '../../../../src/core/runtime/providers/aws/single-node-provisioning-intent.js';
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
const OTHER_SECURITY_GROUP_ID = 'sg-1123456789abcdef0';
const INSTANCE_ID = 'i-0123456789abcdef0';
const OTHER_INSTANCE_ID = 'i-1123456789abcdef0';
const VOLUME_ID = 'vol-0123456789abcdef0';
const OTHER_VOLUME_ID = 'vol-1123456789abcdef0';
const NETWORK_INTERFACE_ID = 'eni-0123456789abcdef0';
const PUBLIC_IPV4 = '203.0.113.40';
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/** @type {Readonly<Record<string, any>>} */
let provisioningIntent;
/** @type {Readonly<Record<string, any>>} */
let identities;

beforeAll(async () => {
  const plan = await resolveAwsSingleNodePlan({
    desired: makeDesired(),
    providerScope: createAwsProviderScope({
      partition: 'aws',
      accountId: ACCOUNT_ID,
      region: REGION,
    }),
    api: makePlanApi(),
  });
  provisioningIntent = createAwsSingleNodeProvisioningIntent({
    plan,
    incarnationId: createSingleNodeDeploymentIncarnationId(
      Buffer.alloc(32, 51),
    ),
    cloudInitDigest: digest('#cloud-config\n'),
  });
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

/** @param {string|Buffer} value */
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
    describeImages: async () => ({
      Images: [
        {
          ImageId: AMI_ID,
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
                SnapshotId: SNAPSHOT_ID,
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
function makeEvidenceApi(overrides = {}) {
  return {
    describeSecurityGroups: jest.fn(async () => ({ SecurityGroups: [] })),
    describeInstances: jest.fn(async () => ({ Reservations: [] })),
    describeVolumes: jest.fn(async () => ({ Volumes: [] })),
    describeInstanceAttribute: jest.fn(
      /** @param {Record<string, any>} request */
      async (request) => exactAttributeResponse(request),
    ),
    describeInstanceCreditSpecifications: jest.fn(async () => ({
      InstanceCreditSpecifications: [],
    })),
    ...overrides,
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

/**
 * @param {Record<string, any>} [instanceOverrides]
 * @param {Record<string, any>} [reservationOverrides]
 */
function reservation(instanceOverrides = {}, reservationOverrides = {}) {
  return {
    ReservationId: 'r-0123456789abcdef0',
    OwnerId: ACCOUNT_ID,
    Instances: [instance(instanceOverrides)],
    ...reservationOverrides,
  };
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
 * Model the actual DescribeInstanceAttribute output shape rather than adding
 * attributes that EC2 does not return from DescribeInstances.
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

/**
 * @param {Record<string, any>} api
 * @param {string|null} [storedResourceId]
 */
function securityGroupInput(api, storedResourceId = null) {
  return { intent: provisioningIntent, storedResourceId, api };
}

/**
 * @param {Record<string, any>} api
 * @param {string|null} [storedResourceId]
 */
function instanceInput(api, storedResourceId = null) {
  return {
    intent: provisioningIntent,
    securityGroupId: SECURITY_GROUP_ID,
    storedResourceId,
    api,
  };
}

/** @param {Record<string, any>} api */
function volumeInput(api) {
  return {
    intent: provisioningIntent,
    instanceId: INSTANCE_ID,
    rootVolumeId: VOLUME_ID,
    api,
  };
}

describe('AWS single-node security-group evidence', () => {
  it('normalizes absent, partial, and exact owned groups', async () => {
    const absent = await inspectAwsSingleNodeSecurityGroup(
      securityGroupInput(makeEvidenceApi()),
    );
    expect(absent).toEqual({
      status: 'absent',
      ownershipStatus: 'absent',
      specStatus: 'absent',
      securityGroupId: null,
      missingIpv4: ['203.0.113.7/32', '203.0.113.9/32'],
    });

    const partialGroup = securityGroup({
      IpPermissions: [
        {
          IpProtocol: 'tcp',
          FromPort: 22,
          ToPort: 22,
          IpRanges: [{ CidrIp: '203.0.113.7/32' }],
        },
      ],
    });
    const partial = await inspectAwsSingleNodeSecurityGroup(
      securityGroupInput(
        makeEvidenceApi({
          describeSecurityGroups: jest.fn(async () => ({
            SecurityGroups: [partialGroup],
          })),
        }),
      ),
    );
    expect(partial).toEqual({
      status: 'present',
      ownershipStatus: 'owned',
      specStatus: 'incomplete',
      securityGroupId: SECURITY_GROUP_ID,
      missingIpv4: ['203.0.113.9/32'],
    });

    const exact = await inspectAwsSingleNodeSecurityGroup(
      securityGroupInput(
        makeEvidenceApi({
          describeSecurityGroups: jest.fn(async () => ({
            SecurityGroups: [securityGroup()],
          })),
        }),
        SECURITY_GROUP_ID,
      ),
    );
    expect(exact).toEqual({
      status: 'present',
      ownershipStatus: 'owned',
      specStatus: 'exact',
      securityGroupId: SECURITY_GROUP_ID,
      missingIpv4: [],
    });
    expect(deeplyFrozen(exact)).toBe(true);
  });

  it('returns owned spec conflict for extra, duplicate, or wrong rules', async () => {
    const variants = [
      securityGroup({
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 22,
            ToPort: 22,
            IpRanges: [
              { CidrIp: '203.0.113.7/32' },
              { CidrIp: '203.0.113.9/32' },
              { CidrIp: '198.51.100.1/32' },
            ],
          },
        ],
      }),
      securityGroup({
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 22,
            ToPort: 22,
            IpRanges: [
              { CidrIp: '203.0.113.7/32' },
              { CidrIp: '203.0.113.7/32' },
            ],
          },
        ],
      }),
      securityGroup({
        IpPermissionsEgress: [
          {
            IpProtocol: '-1',
            IpRanges: [{ CidrIp: '0.0.0.0/0' }, { CidrIp: '0.0.0.0/0' }],
          },
        ],
      }),
    ];
    for (const candidate of variants) {
      const result = await inspectAwsSingleNodeSecurityGroup(
        securityGroupInput(
          makeEvidenceApi({
            describeSecurityGroups: jest.fn(async () => ({
              SecurityGroups: [candidate],
            })),
          }),
        ),
      );
      expect(result).toMatchObject({
        status: 'present',
        ownershipStatus: 'owned',
        specStatus: 'conflict',
        securityGroupId: SECURITY_GROUP_ID,
      });
    }
  });

  it('rejects natural-slot collisions, wrong ownership tags, and multiple IDs', async () => {
    const wrongTags = securityGroup({
      Tags: clone(identities.securityGroup.tags).map(
        (/** @type {{Key: string, Value: string}} */ tag) =>
          tag.Key === 'wharfie:ownership-nonce'
            ? { ...tag, Value: 'wrong-but-provider-valid' }
            : tag,
      ),
    });
    await expect(
      inspectAwsSingleNodeSecurityGroup(
        securityGroupInput(
          makeEvidenceApi({
            describeSecurityGroups: jest.fn(async () => ({
              SecurityGroups: [wrongTags],
            })),
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeEvidenceConflictError);

    await expect(
      inspectAwsSingleNodeSecurityGroup(
        securityGroupInput(
          makeEvidenceApi({
            describeSecurityGroups: jest.fn(async () => ({
              SecurityGroups: [
                securityGroup(),
                securityGroup({ GroupId: OTHER_SECURITY_GROUP_ID }),
              ],
            })),
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeEvidenceConflictError);

    await expect(
      inspectAwsSingleNodeSecurityGroup(
        securityGroupInput(
          makeEvidenceApi({
            describeSecurityGroups: jest.fn(async () => ({
              SecurityGroups: [securityGroup()],
            })),
          }),
          OTHER_SECURITY_GROUP_ID,
        ),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeEvidenceConflictError);
  });
});

describe('AWS single-node instance evidence', () => {
  it('normalizes absent and an exact running instance', async () => {
    const absent = await inspectAwsSingleNodeInstance(
      instanceInput(makeEvidenceApi()),
    );
    expect(absent).toEqual({
      status: 'absent',
      ownershipStatus: 'absent',
      specStatus: 'absent',
      instanceId: null,
      instanceState: null,
      rootVolumeId: null,
      publicIpv4: null,
    });

    /** @type {unknown[]} */
    const receivers = [];
    const describeInstanceAttribute = jest.fn(
      /**
       * @this {unknown}
       * @param {Record<string, any>} request
       */
      async function (request) {
        receivers.push(this);
        return exactAttributeResponse(request);
      },
    );
    /** @type {unknown[]} */
    const creditReceivers = [];
    const describeInstanceCreditSpecifications = jest.fn(
      /**
       * @this {unknown}
       * @param {Record<string, any>} request
       */
      async function (request) {
        creditReceivers.push(this);
        return exactCreditResponse();
      },
    );
    const exact = await inspectAwsSingleNodeInstance(
      instanceInput(
        makeEvidenceApi({
          describeInstances: jest.fn(async () => ({
            Reservations: [reservation()],
          })),
          describeInstanceAttribute,
          describeInstanceCreditSpecifications,
        }),
        INSTANCE_ID,
      ),
    );
    expect(exact).toEqual({
      status: 'present',
      ownershipStatus: 'owned',
      specStatus: 'exact',
      instanceId: INSTANCE_ID,
      instanceState: 'running',
      rootVolumeId: VOLUME_ID,
      publicIpv4: PUBLIC_IPV4,
    });
    expect(deeplyFrozen(exact)).toBe(true);
    expect(describeInstanceAttribute.mock.calls.map((call) => call[0])).toEqual(
      [
        { InstanceId: INSTANCE_ID, Attribute: 'disableApiStop' },
        { InstanceId: INSTANCE_ID, Attribute: 'disableApiTermination' },
        {
          InstanceId: INSTANCE_ID,
          Attribute: 'instanceInitiatedShutdownBehavior',
        },
      ],
    );
    expect(
      describeInstanceAttribute.mock.calls.every((call) =>
        Object.isFrozen(call[0]),
      ),
    ).toBe(true);
    expect(receivers).toEqual([undefined, undefined, undefined]);
    expect(describeInstanceCreditSpecifications).toHaveBeenCalledWith({
      InstanceIds: [INSTANCE_ID],
    });
    const creditRequest = describeInstanceCreditSpecifications.mock.calls[0][0];
    expect(Object.isFrozen(creditRequest)).toBe(true);
    expect(Object.isFrozen(creditRequest.InstanceIds)).toBe(true);
    expect(creditReceivers).toEqual([undefined]);
  });

  it('returns settling while pending provider fields are late', async () => {
    const lateInterface = clone(instance().NetworkInterfaces[0]);
    delete lateInterface.Association;
    const api = makeEvidenceApi({
      describeInstances: jest.fn(async () => ({
        Reservations: [
          reservation({
            State: { Name: 'pending' },
            MetadataOptions: {
              ...instance().MetadataOptions,
              State: 'pending',
            },
            NetworkInterfaces: [lateInterface],
            PublicIpAddress: undefined,
            BlockDeviceMappings: [],
          }),
        ],
      })),
      describeInstanceCreditSpecifications: jest.fn(async () => ({
        InstanceCreditSpecifications: [],
      })),
    });

    await expect(
      inspectAwsSingleNodeInstance(instanceInput(api)),
    ).resolves.toEqual({
      status: 'settling',
      ownershipStatus: 'owned',
      specStatus: 'incomplete',
      instanceId: INSTANCE_ID,
      instanceState: 'pending',
      rootVolumeId: null,
      publicIpv4: null,
    });
  });

  it('distinguishes deletion terminal from stopped instances needing termination', async () => {
    for (const state of ['shutting-down', 'terminated']) {
      const describeInstanceAttribute = jest.fn(
        /** @param {Record<string, any>} request */
        async (request) => exactAttributeResponse(request),
      );
      const describeInstanceCreditSpecifications = jest.fn(async () =>
        exactCreditResponse(),
      );
      const result = await inspectAwsSingleNodeInstance(
        instanceInput(
          makeEvidenceApi({
            describeInstances: jest.fn(async () => ({
              Reservations: [reservation({ State: { Name: state } })],
            })),
            describeInstanceAttribute,
            describeInstanceCreditSpecifications,
          }),
        ),
      );
      expect(result.status).toBe('terminal');
      expect(result.instanceState).toBe(state);
      expect(result.ownershipStatus).toBe('owned');
      expect(describeInstanceAttribute).not.toHaveBeenCalled();
      expect(describeInstanceCreditSpecifications).not.toHaveBeenCalled();
    }

    for (const state of ['stopping', 'stopped']) {
      const result = await inspectAwsSingleNodeInstance(
        instanceInput(
          makeEvidenceApi({
            describeInstances: jest.fn(async () => ({
              Reservations: [reservation({ State: { Name: state } })],
            })),
            describeInstanceCreditSpecifications: jest.fn(async () =>
              exactCreditResponse(),
            ),
          }),
        ),
      );
      expect(result).toMatchObject({
        status: 'present',
        ownershipStatus: 'owned',
        specStatus: 'conflict',
        instanceState: state,
      });
    }
  });

  it('returns owned spec conflict for launch drift and nonstandard CPU credits', async () => {
    const drifted = reservation({
      KeyName: 'unexpected-key',
      Placement: { AvailabilityZone: 'us-east-2b', Tenancy: 'host' },
    });
    const result = await inspectAwsSingleNodeInstance(
      instanceInput(
        makeEvidenceApi({
          describeInstances: jest.fn(async () => ({
            Reservations: [drifted],
          })),
          describeInstanceCreditSpecifications: jest.fn(async () => ({
            InstanceCreditSpecifications: [
              { InstanceId: INSTANCE_ID, CpuCredits: 'unlimited' },
            ],
          })),
        }),
      ),
    );
    expect(result).toMatchObject({
      status: 'present',
      ownershipStatus: 'owned',
      specStatus: 'conflict',
      instanceId: INSTANCE_ID,
    });
  });

  it('returns owned spec conflict for instance-attribute drift', async () => {
    const result = await inspectAwsSingleNodeInstance(
      instanceInput(
        makeEvidenceApi({
          describeInstances: jest.fn(async () => ({
            Reservations: [reservation()],
          })),
          describeInstanceAttribute: jest.fn(
            /** @param {Record<string, any>} request */
            async (request) =>
              exactAttributeResponse(request, {
                disableApiTermination: true,
              }),
          ),
          describeInstanceCreditSpecifications: jest.fn(async () =>
            exactCreditResponse(),
          ),
        }),
      ),
    );
    expect(result).toMatchObject({
      status: 'present',
      ownershipStatus: 'owned',
      specStatus: 'conflict',
      instanceId: INSTANCE_ID,
    });
  });

  it('rejects a malformed instance-attribute response', async () => {
    await expect(
      inspectAwsSingleNodeInstance(
        instanceInput(
          makeEvidenceApi({
            describeInstances: jest.fn(async () => ({
              Reservations: [reservation()],
            })),
            describeInstanceAttribute: jest.fn(
              /** @param {Record<string, any>} request */
              async (request) => ({
                $metadata: { httpStatusCode: 200 },
                InstanceId: request.InstanceId,
                DisableApiTermination: { Value: false },
              }),
            ),
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeEvidenceUnknownError);
  });

  it('rejects pagination from one exact CPU-credit lookup', async () => {
    await expect(
      inspectAwsSingleNodeInstance(
        instanceInput(
          makeEvidenceApi({
            describeInstances: jest.fn(async () => ({
              Reservations: [reservation()],
            })),
            describeInstanceCreditSpecifications: jest.fn(async () => ({
              ...exactCreditResponse(),
              NextToken: 'unexpected-credit-page',
            })),
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeEvidenceUnknownError);
  });

  it('rejects instance ownership, natural-slot, and stored-ID conflicts', async () => {
    const wrongTags = clone(identities.instance.tags);
    wrongTags[0].Value = 'wrong-owned-value';
    await expect(
      inspectAwsSingleNodeInstance(
        instanceInput(
          makeEvidenceApi({
            describeInstances: jest.fn(async () => ({
              Reservations: [reservation({ Tags: wrongTags })],
            })),
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeEvidenceConflictError);

    await expect(
      inspectAwsSingleNodeInstance(
        instanceInput(
          makeEvidenceApi({
            describeInstances: jest.fn(async () => ({
              Reservations: [
                reservation(),
                reservation(
                  { InstanceId: OTHER_INSTANCE_ID },
                  { ReservationId: 'r-1123456789abcdef0' },
                ),
              ],
            })),
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeEvidenceConflictError);

    await expect(
      inspectAwsSingleNodeInstance(
        instanceInput(
          makeEvidenceApi({
            describeInstances: jest.fn(async () => ({
              Reservations: [reservation()],
            })),
          }),
          OTHER_INSTANCE_ID,
        ),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeEvidenceConflictError);
  });
});

describe('AWS single-node root-volume evidence', () => {
  it('normalizes absent and exact attached volumes', async () => {
    const absent = await inspectAwsSingleNodeRootVolume(
      volumeInput(makeEvidenceApi()),
    );
    expect(absent).toEqual({
      status: 'absent',
      ownershipStatus: 'absent',
      specStatus: 'absent',
      volumeId: null,
      volumeState: null,
      attachmentStatus: null,
    });

    const exact = await inspectAwsSingleNodeRootVolume(
      volumeInput(
        makeEvidenceApi({
          describeVolumes: jest.fn(async () => ({ Volumes: [volume()] })),
        }),
      ),
    );
    expect(exact).toEqual({
      status: 'present',
      ownershipStatus: 'owned',
      specStatus: 'exact',
      volumeId: VOLUME_ID,
      volumeState: 'in-use',
      attachmentStatus: 'expected',
    });
    expect(deeplyFrozen(exact)).toBe(true);
  });

  it('normalizes creating, available, and deleting lifecycle states', async () => {
    const cases = [
      {
        candidate: volume({ State: 'creating', Attachments: [] }),
        expected: {
          status: 'settling',
          specStatus: 'incomplete',
          attachmentStatus: 'none',
          volumeState: 'creating',
        },
      },
      {
        candidate: volume({ State: 'available', Attachments: [] }),
        expected: {
          status: 'available',
          specStatus: 'exact',
          attachmentStatus: 'none',
          volumeState: 'available',
        },
      },
      {
        candidate: volume({
          State: 'deleting',
          Attachments: [
            {
              ...volume().Attachments[0],
              State: 'detaching',
            },
          ],
        }),
        expected: {
          status: 'deleting',
          specStatus: 'incomplete',
          attachmentStatus: 'expected',
          volumeState: 'deleting',
        },
      },
    ];
    for (const { candidate, expected } of cases) {
      const result = await inspectAwsSingleNodeRootVolume(
        volumeInput(
          makeEvidenceApi({
            describeVolumes: jest.fn(async () => ({
              Volumes: [candidate],
            })),
          }),
        ),
      );
      expect(result).toMatchObject({
        ownershipStatus: 'owned',
        volumeId: VOLUME_ID,
        ...expected,
      });
    }
  });

  it('returns owned drift and marks an unexpected attachment explicitly', async () => {
    const candidate = volume({
      Iops: 6000,
      Attachments: [
        {
          ...volume().Attachments[0],
          InstanceId: OTHER_INSTANCE_ID,
        },
      ],
    });
    const result = await inspectAwsSingleNodeRootVolume(
      volumeInput(
        makeEvidenceApi({
          describeVolumes: jest.fn(async () => ({ Volumes: [candidate] })),
        }),
      ),
    );
    expect(result).toEqual({
      status: 'present',
      ownershipStatus: 'owned',
      specStatus: 'conflict',
      volumeId: VOLUME_ID,
      volumeState: 'in-use',
      attachmentStatus: 'unexpected',
    });
  });

  it('cross-checks the full-tag natural slot against the mapped volume ID', async () => {
    const describeVolumes = jest.fn(
      /** @param {Record<string, any>} request */
      async (request) => {
        const firstFilter = request.Filters[0];
        return firstFilter.Name === 'volume-id'
          ? { Volumes: [volume()] }
          : { Volumes: [volume({ VolumeId: OTHER_VOLUME_ID })] };
      },
    );
    await expect(
      inspectAwsSingleNodeRootVolume(
        volumeInput(makeEvidenceApi({ describeVolumes })),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeEvidenceConflictError);
    expect(describeVolumes).toHaveBeenCalledTimes(2);
    const firstRequest = /** @type {Record<string, any>} */ (
      describeVolumes.mock.calls[0][0]
    );
    expect(firstRequest.Filters).toEqual(
      identities.rootVolume.tags.map(
        (/** @type {{Key: string, Value: string}} */ tag) => ({
          Name: `tag:${tag.Key}`,
          Values: [tag.Value],
        }),
      ),
    );
  });

  it('rejects wrong volume ownership and duplicate provider IDs', async () => {
    const wrongTags = clone(identities.rootVolume.tags);
    wrongTags[0].Value = 'wrong-owned-value';
    await expect(
      inspectAwsSingleNodeRootVolume(
        volumeInput(
          makeEvidenceApi({
            describeVolumes: jest.fn(async () => ({
              Volumes: [volume({ Tags: wrongTags })],
            })),
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeEvidenceConflictError);

    await expect(
      inspectAwsSingleNodeRootVolume(
        volumeInput(
          makeEvidenceApi({
            describeVolumes: jest.fn(async () => ({
              Volumes: [volume(), volume()],
            })),
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeEvidenceUnknownError);
  });
});

describe('AWS single-node evidence read boundary', () => {
  it('rejects paginator token loops and sanitizes provider failures', async () => {
    const looping = makeEvidenceApi({
      describeSecurityGroups: jest.fn(async () => ({
        SecurityGroups: [],
        NextToken: 'same-token',
      })),
    });
    await expect(
      inspectAwsSingleNodeSecurityGroup(securityGroupInput(looping)),
    ).rejects.toBeInstanceOf(AwsSingleNodeEvidenceUnknownError);

    const sentinel = 'provider-credential-secret-sentinel';
    const failing = makeEvidenceApi({
      describeSecurityGroups: jest.fn(async () => {
        throw new Error(sentinel);
      }),
    });
    let thrown;
    try {
      await inspectAwsSingleNodeSecurityGroup(securityGroupInput(failing));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AwsSingleNodeEvidenceTransientError);
    expect(String(thrown)).not.toContain(sentinel);
    expect(/** @type {Error & {cause?: unknown}} */ (thrown).cause).toBe(
      undefined,
    );
  });

  it('isolates read receivers and cannot reach an injected mutation', async () => {
    const runInstances = jest.fn(async () => {
      throw new Error('must not run');
    });
    /** @type {unknown} */
    let observedReceiver = Symbol('not-called');
    /**
     * @this {Record<string, any>|undefined}
     * @returns {{SecurityGroups: never[]}|Promise<unknown>}
     */
    function isolatedRead() {
      observedReceiver = this;
      if (typeof this?.runInstances === 'function') {
        return this.runInstances();
      }
      return { SecurityGroups: [] };
    }
    const api = makeEvidenceApi({
      describeSecurityGroups: jest.fn(isolatedRead),
      runInstances,
    });

    await expect(
      inspectAwsSingleNodeSecurityGroup(securityGroupInput(api)),
    ).resolves.toMatchObject({ status: 'absent' });
    expect(observedReceiver).toBeUndefined();
    expect(runInstances).not.toHaveBeenCalled();
  });

  it('requires nullable stored IDs and exact own-data input fields', async () => {
    const api = makeEvidenceApi();
    await expect(
      inspectAwsSingleNodeSecurityGroup({
        intent: provisioningIntent,
        storedResourceId: undefined,
        api,
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodeEvidenceUnknownError);
    await expect(
      inspectAwsSingleNodeSecurityGroup({
        ...securityGroupInput(api),
        credentials: 'must-never-be-accepted',
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodeEvidenceUnknownError);
  });
});
