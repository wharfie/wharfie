import { beforeAll, describe, expect, it } from '@jest/globals';

import { createApplicationRevision } from '../../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../../../src/core/runtime/content-id.js';
import { createAwsProviderScope } from '../../../../src/core/runtime/deployment-provider-scope.js';
import {
  AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
  createAwsSingleNodeResourceIdentity,
  createAwsSingleNodeRunInstancesClientToken,
} from '../../../../src/core/runtime/providers/aws/resource-identity.js';
import {
  AWS_SINGLE_NODE_PRIMARY_NETWORK_INTERFACE_DESCRIPTION,
  AWS_SINGLE_NODE_ROOT_VOLUME_IOPS,
  AWS_SINGLE_NODE_ROOT_VOLUME_THROUGHPUT,
  createAwsSingleNodeAuthorizeSecurityGroupIngressRequest,
  createAwsSingleNodeCreateSecurityGroupRequest,
  createAwsSingleNodeDeleteSecurityGroupRequest,
  createAwsSingleNodeDeleteVolumeRequest,
  createAwsSingleNodeRunInstancesRequest,
  createAwsSingleNodeTerminateInstancesRequest,
} from '../../../../src/core/runtime/providers/aws/single-node-requests.js';
import {
  AWS_SINGLE_NODE_INSTANCE_TYPE,
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
const INSTANCE_ID = 'i-0123456789abcdef0';
const VOLUME_ID = 'vol-0123456789abcdef0';
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

beforeAll(async () => {
  plan = await resolveAwsSingleNodePlan({
    desired: makeDesired(),
    providerScope: createAwsProviderScope({
      partition: 'aws',
      accountId: ACCOUNT_ID,
      region: REGION,
    }),
    api: makeReadApi(),
  });
  provisioningIntent = makeProvisioningIntent(CLOUD_INIT_BYTES);
});

/** @param {string|Buffer|Uint8Array} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {Buffer|Uint8Array} cloudInitBytes */
function makeProvisioningIntent(cloudInitBytes) {
  return createAwsSingleNodeProvisioningIntent({
    plan,
    incarnationId: createSingleNodeDeploymentIncarnationId(
      Buffer.alloc(32, 37),
    ),
    cloudInitDigest: digest(cloudInitBytes),
  });
}

/** @param {Readonly<Record<string, any>>} intent */
function identitiesFor(intent) {
  return {
    securityGroupIdentity: createAwsSingleNodeResourceIdentity(
      intent,
      'securityGroup',
    ),
    instanceIdentity: createAwsSingleNodeResourceIdentity(intent, 'instance'),
    rootVolumeIdentity: createAwsSingleNodeResourceIdentity(
      intent,
      'rootVolume',
    ),
  };
}

/**
 * @param {Readonly<Record<string, any>>} [intent]
 * @param {Buffer|Uint8Array} [cloudInitBytes]
 */
function runInput(
  intent = provisioningIntent,
  cloudInitBytes = CLOUD_INIT_BYTES,
) {
  return {
    provisioningIntent: intent,
    ...identitiesFor(intent),
    securityGroupId: SECURITY_GROUP_ID,
    cloudInitBytes,
  };
}

/** @param {Readonly<Record<string, any>>} identity */
function expectedTags(identity) {
  return identity.tags.map(
    (/** @type {{Key: string, Value: string}} */ tag) => ({
      Key: tag.Key,
      Value: tag.Value,
    }),
  );
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
      allowedIpv4: ['203.0.113.9/32', '203.0.113.7/32', '203.0.113.9/32'],
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
  const entries = [];
  for (const Egress of [false, true]) {
    entries.push(
      {
        RuleNumber: 100,
        Protocol: '-1',
        RuleAction: 'allow',
        Egress,
        CidrBlock: '0.0.0.0/0',
      },
      {
        RuleNumber: 101,
        Protocol: '-1',
        RuleAction: 'allow',
        Egress,
        Ipv6CidrBlock: '::/0',
      },
      {
        RuleNumber: 32767,
        Protocol: '-1',
        RuleAction: 'deny',
        Egress,
        CidrBlock: '0.0.0.0/0',
      },
      {
        RuleNumber: 32767,
        Protocol: '-1',
        RuleAction: 'deny',
        Egress,
        Ipv6CidrBlock: '::/0',
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
        Entries: entries,
      },
    ],
  };
}

function makeReadApi() {
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

describe('AWS single-node mutation request builders', () => {
  it('builds exact immutable security-group creation and sorted SSH ingress', () => {
    const identities = identitiesFor(provisioningIntent);
    const createRequest = createAwsSingleNodeCreateSecurityGroupRequest({
      provisioningIntent,
      securityGroupIdentity: identities.securityGroupIdentity,
    });
    expect(createRequest).toEqual({
      GroupName: identities.securityGroupIdentity.name,
      Description: AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
      VpcId: VPC_ID,
      TagSpecifications: [
        {
          ResourceType: 'security-group',
          Tags: expectedTags(identities.securityGroupIdentity),
        },
      ],
    });
    expect(createRequest).not.toHaveProperty('GroupDescription');
    expect(createRequest.TagSpecifications[0].Tags).not.toBe(
      identities.securityGroupIdentity.tags,
    );

    const ingressRequest =
      createAwsSingleNodeAuthorizeSecurityGroupIngressRequest({
        provisioningIntent,
        securityGroupIdentity: identities.securityGroupIdentity,
        securityGroupId: SECURITY_GROUP_ID,
        allowedIpv4: ['203.0.113.9/32'],
      });
    expect(ingressRequest).toEqual({
      GroupId: SECURITY_GROUP_ID,
      IpPermissions: [
        {
          IpProtocol: 'tcp',
          FromPort: 22,
          ToPort: 22,
          IpRanges: [{ CidrIp: '203.0.113.9/32' }],
        },
      ],
    });
    expect(deeplyFrozen(createRequest)).toBe(true);
    expect(deeplyFrozen(ingressRequest)).toBe(true);
  });

  it('builds the exact immutable minimal RunInstances request', () => {
    const identities = identitiesFor(provisioningIntent);
    const spec = provisioningIntent.plan.providerSpec;
    const root = spec.image.rootBlockDevice;
    const request = createAwsSingleNodeRunInstancesRequest(
      runInput(provisioningIntent),
    );

    expect(request).toEqual({
      ImageId: AMI_ID,
      InstanceType: 't3.small',
      MinCount: 1,
      MaxCount: 1,
      ClientToken:
        createAwsSingleNodeRunInstancesClientToken(provisioningIntent),
      CreditSpecification: { CpuCredits: 'standard' },
      CapacityReservationSpecification: {
        CapacityReservationPreference: 'none',
      },
      Monitoring: { Enabled: false },
      EbsOptimized: true,
      DisableApiStop: false,
      DisableApiTermination: false,
      InstanceInitiatedShutdownBehavior: 'stop',
      HibernationOptions: { Configured: false },
      EnclaveOptions: { Enabled: false },
      MetadataOptions: {
        HttpEndpoint: 'enabled',
        HttpTokens: 'required',
        HttpPutResponseHopLimit: 1,
        HttpProtocolIpv6: 'disabled',
        InstanceMetadataTags: 'disabled',
      },
      NetworkInterfaces: [
        {
          DeviceIndex: 0,
          NetworkCardIndex: 0,
          InterfaceType: 'interface',
          Description: AWS_SINGLE_NODE_PRIMARY_NETWORK_INTERFACE_DESCRIPTION,
          AssociatePublicIpAddress: true,
          DeleteOnTermination: true,
          SubnetId: SUBNET_ID,
          Groups: [SECURITY_GROUP_ID],
        },
      ],
      BlockDeviceMappings: [
        {
          DeviceName: spec.image.rootDeviceName,
          Ebs: {
            SnapshotId: root.snapshotId,
            VolumeType: 'gp3',
            VolumeSize: root.sizeGiB,
            Iops: AWS_SINGLE_NODE_ROOT_VOLUME_IOPS,
            Throughput: AWS_SINGLE_NODE_ROOT_VOLUME_THROUGHPUT,
            Encrypted: true,
            DeleteOnTermination: true,
          },
        },
      ],
      UserData: CLOUD_INIT_BYTES.toString('base64'),
      TagSpecifications: [
        {
          ResourceType: 'instance',
          Tags: expectedTags(identities.instanceIdentity),
        },
        {
          ResourceType: 'volume',
          Tags: expectedTags(identities.rootVolumeIdentity),
        },
      ],
    });
    expect(request).not.toHaveProperty('IamInstanceProfile');
    expect(request).not.toHaveProperty('KeyName');
    expect(request).not.toHaveProperty('LaunchTemplate');
    expect(request).not.toHaveProperty('InstanceMarketOptions');
    expect(request.DisableApiStop).toBe(false);
    expect(request.NetworkInterfaces[0]).not.toHaveProperty('Ipv6AddressCount');
    expect(request.NetworkInterfaces[0]).not.toHaveProperty('Ipv6Addresses');
    expect(request.BlockDeviceMappings).toHaveLength(1);
    expect(deeplyFrozen(request)).toBe(true);
  });

  it('copies cloud-init and identity values instead of retaining mutable input', () => {
    const cloudInitBytes = Buffer.from(CLOUD_INIT_BYTES);
    const identities = identitiesFor(provisioningIntent);
    const mutableInstanceIdentity = /** @type {any} */ (
      clone(identities.instanceIdentity)
    );
    const request = createAwsSingleNodeRunInstancesRequest({
      provisioningIntent,
      securityGroupIdentity: clone(identities.securityGroupIdentity),
      instanceIdentity: mutableInstanceIdentity,
      rootVolumeIdentity: clone(identities.rootVolumeIdentity),
      securityGroupId: SECURITY_GROUP_ID,
      cloudInitBytes,
    });
    const encoded = request.UserData;
    const firstTag = request.TagSpecifications[0].Tags[0].Value;

    cloudInitBytes.fill(0);
    mutableInstanceIdentity.tags[0].Value = 'mutated';

    expect(request.UserData).toBe(encoded);
    expect(request.TagSpecifications[0].Tags[0].Value).toBe(firstTag);
    expect(request.TagSpecifications[0].Tags).not.toBe(
      mutableInstanceIdentity.tags,
    );
  });

  it('accepts copied Uint8Array bytes and enforces digest and maximum size', () => {
    const uint8Bytes = new Uint8Array(CLOUD_INIT_BYTES);
    const uint8Request = createAwsSingleNodeRunInstancesRequest(
      runInput(provisioningIntent, uint8Bytes),
    );
    expect(uint8Request.UserData).toBe(CLOUD_INIT_BYTES.toString('base64'));

    const mismatchedIntent = makeProvisioningIntent(
      Buffer.from('#cloud-config\npackages: []\n'),
    );
    expect(() =>
      createAwsSingleNodeRunInstancesRequest(
        runInput(mismatchedIntent, CLOUD_INIT_BYTES),
      ),
    ).toThrow(/digest/iu);

    const maximum = Buffer.alloc(SINGLE_NODE_CLOUD_INIT_MAX_BYTES, 0x78);
    const maximumIntent = makeProvisioningIntent(maximum);
    expect(
      createAwsSingleNodeRunInstancesRequest(runInput(maximumIntent, maximum))
        .UserData,
    ).toBe(maximum.toString('base64'));

    const oversized = Buffer.alloc(SINGLE_NODE_CLOUD_INIT_MAX_BYTES + 1, 0x78);
    const oversizedIntent = makeProvisioningIntent(oversized);
    expect(() =>
      createAwsSingleNodeRunInstancesRequest(
        runInput(oversizedIntent, oversized),
      ),
    ).toThrow(RangeError);
    expect(() =>
      createAwsSingleNodeRunInstancesRequest({
        ...runInput(provisioningIntent),
        cloudInitBytes: CLOUD_INIT_BYTES.buffer,
      }),
    ).toThrow(/Buffer or Uint8Array/iu);

    const empty = Buffer.alloc(0);
    const emptyIntent = makeProvisioningIntent(empty);
    expect(() =>
      createAwsSingleNodeRunInstancesRequest(runInput(emptyIntent, empty)),
    ).toThrow(RangeError);
  });

  it('builds exact immutable cleanup requests bound to resource identities', () => {
    const identities = identitiesFor(provisioningIntent);
    const terminate = createAwsSingleNodeTerminateInstancesRequest({
      provisioningIntent,
      instanceIdentity: identities.instanceIdentity,
      instanceId: INSTANCE_ID,
    });
    const deleteVolume = createAwsSingleNodeDeleteVolumeRequest({
      provisioningIntent,
      rootVolumeIdentity: identities.rootVolumeIdentity,
      volumeId: VOLUME_ID,
    });
    const deleteSecurityGroup = createAwsSingleNodeDeleteSecurityGroupRequest({
      provisioningIntent,
      securityGroupIdentity: identities.securityGroupIdentity,
      securityGroupId: SECURITY_GROUP_ID,
    });

    expect(terminate).toEqual({
      InstanceIds: [INSTANCE_ID],
      Force: false,
      SkipOsShutdown: false,
    });
    expect(deleteVolume).toEqual({ VolumeId: VOLUME_ID });
    expect(deleteSecurityGroup).toEqual({ GroupId: SECURITY_GROUP_ID });
    expect(deeplyFrozen(terminate)).toBe(true);
    expect(deeplyFrozen(deleteVolume)).toBe(true);
    expect(deeplyFrozen(deleteSecurityGroup)).toBe(true);
  });

  it('rejects malformed IDs, extra authority, identity mismatch, and intent tampering', () => {
    const identities = identitiesFor(provisioningIntent);
    expect(() =>
      createAwsSingleNodeAuthorizeSecurityGroupIngressRequest({
        provisioningIntent,
        securityGroupIdentity: identities.securityGroupIdentity,
        securityGroupId: 'sg-NOT-CANONICAL',
        allowedIpv4: ['203.0.113.7/32'],
      }),
    ).toThrow(/securityGroupId is invalid/iu);
    expect(() =>
      createAwsSingleNodeTerminateInstancesRequest({
        provisioningIntent,
        instanceIdentity: identities.instanceIdentity,
        instanceId: 'i-xyz',
      }),
    ).toThrow(/instanceId is invalid/iu);
    expect(() =>
      createAwsSingleNodeDeleteVolumeRequest({
        provisioningIntent,
        rootVolumeIdentity: identities.rootVolumeIdentity,
        volumeId: 'vol-xyz',
      }),
    ).toThrow(/volumeId is invalid/iu);

    for (const allowedIpv4 of [
      [],
      ['198.51.100.1/32'],
      ['203.0.113.9/32', '203.0.113.7/32'],
      ['203.0.113.7/32', '203.0.113.7/32'],
    ]) {
      expect(() =>
        createAwsSingleNodeAuthorizeSecurityGroupIngressRequest({
          provisioningIntent,
          securityGroupIdentity: identities.securityGroupIdentity,
          securityGroupId: SECURITY_GROUP_ID,
          allowedIpv4,
        }),
      ).toThrow(/allowedIpv4/iu);
    }

    const extraAuthority = {
      provisioningIntent,
      securityGroupIdentity: identities.securityGroupIdentity,
      credentials: { accessKeyId: 'must-not-be-retained' },
    };
    expect(() =>
      createAwsSingleNodeCreateSecurityGroupRequest(extraAuthority),
    ).toThrow(/fields are invalid/iu);

    const tamperedIdentity = /** @type {any} */ (
      clone(identities.instanceIdentity)
    );
    tamperedIdentity.name = tamperedIdentity.name.replace(/.$/u, '0');
    expect(() =>
      createAwsSingleNodeRunInstancesRequest({
        ...runInput(provisioningIntent),
        instanceIdentity: tamperedIdentity,
      }),
    ).toThrow(/does not match the provisioning intent/iu);
    expect(() =>
      createAwsSingleNodeRunInstancesRequest({
        ...runInput(provisioningIntent),
        instanceIdentity: identities.rootVolumeIdentity,
      }),
    ).toThrow(/does not match the provisioning intent/iu);

    const tamperedIntent = clone(provisioningIntent);
    tamperedIntent.plan.providerSpec.vpc.vpcId = 'vpc-0fedcba9876543210';
    expect(() =>
      createAwsSingleNodeCreateSecurityGroupRequest({
        provisioningIntent: tamperedIntent,
        securityGroupIdentity: identities.securityGroupIdentity,
      }),
    ).toThrow();
  });

  it('rejects accessor-bearing request and identity inputs without invoking them', () => {
    const identities = identitiesFor(provisioningIntent);
    let requestGetterRead = false;
    const accessorRequest = {
      securityGroupIdentity: identities.securityGroupIdentity,
    };
    Object.defineProperty(accessorRequest, 'provisioningIntent', {
      enumerable: true,
      get() {
        requestGetterRead = true;
        return provisioningIntent;
      },
    });
    expect(() =>
      createAwsSingleNodeCreateSecurityGroupRequest(accessorRequest),
    ).toThrow(/own data field/iu);
    expect(requestGetterRead).toBe(false);

    let identityGetterRead = false;
    const accessorIdentity = clone(identities.securityGroupIdentity);
    Object.defineProperty(accessorIdentity, 'name', {
      enumerable: true,
      get() {
        identityGetterRead = true;
        return identities.securityGroupIdentity.name;
      },
    });
    expect(() =>
      createAwsSingleNodeCreateSecurityGroupRequest({
        provisioningIntent,
        securityGroupIdentity: accessorIdentity,
      }),
    ).toThrow(/plain JSON property/iu);
    expect(identityGetterRead).toBe(false);
  });
});
