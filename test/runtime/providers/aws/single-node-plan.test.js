import { describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../../../src/core/runtime/content-id.js';
import { createAwsProviderScope } from '../../../../src/core/runtime/deployment-provider-scope.js';
import {
  AWS_SINGLE_NODE_INSTANCE_TYPE,
  AWS_SINGLE_NODE_UBUNTU_PARAMETER,
  AwsSingleNodePlanEvidenceError,
  AwsSingleNodePlanReadError,
  resolveAwsSingleNodePlan,
  validateAwsSingleNodePlan,
} from '../../../../src/core/runtime/providers/aws/single-node-plan.js';
import { createSingleNodeDeploymentDesired } from '../../../../src/core/runtime/single-node-deployment-desired.js';
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
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/** @param {string|Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
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

function providerScope() {
  return createAwsProviderScope({
    partition: 'aws',
    accountId: ACCOUNT_ID,
    region: REGION,
  });
}

function parameterResponse() {
  return {
    Parameter: {
      Name: AWS_SINGLE_NODE_UBUNTU_PARAMETER,
      Type: 'String',
      Value: AMI_ID,
      Version: 42,
      ARN: `arn:aws:ssm:${REGION}::parameter${AWS_SINGLE_NODE_UBUNTU_PARAMETER}`,
      DataType: 'text',
      LastModifiedDate: new Date('2026-07-01T00:00:00.000Z'),
    },
  };
}

function imageResponse() {
  return {
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
  };
}

/** @param {string} [subnetId] @returns {Record<string, any>} */
function networkAclResponse(subnetId = SUBNET_ID) {
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
            SubnetId: subnetId,
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
  };
}

/**
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function makeApi(overrides = {}) {
  return {
    getParameter: jest.fn(async () => parameterResponse()),
    describeImages: jest.fn(async () => imageResponse()),
    describeInstanceTypeOfferings: jest.fn(async () => ({
      InstanceTypeOfferings: [
        {
          InstanceType: AWS_SINGLE_NODE_INSTANCE_TYPE,
          Location: 'use2-az1',
        },
      ],
    })),
    describeInstances: jest.fn(async () => ({ Reservations: [] })),
    describeInternetGateways: jest.fn(async () => ({
      InternetGateways: [
        {
          InternetGatewayId: INTERNET_GATEWAY_ID,
          OwnerId: ACCOUNT_ID,
          Attachments: [{ VpcId: VPC_ID, State: 'available' }],
        },
      ],
    })),
    describeNetworkAcls: jest.fn(
      /** @param {Record<string, any>} request */
      async (request) => {
        const associationFilter = request.Filters.find(
          /** @param {Record<string, any>} filter */
          (filter) => filter.Name === 'association.subnet-id',
        );
        return networkAclResponse(associationFilter.Values[0]);
      },
    ),
    describeRouteTables: jest.fn(async () => ({
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
    })),
    describeSecurityGroups: jest.fn(async () => ({ SecurityGroups: [] })),
    describeSubnets: jest.fn(async () => ({
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
    })),
    describeVolumes: jest.fn(async () => ({ Volumes: [] })),
    describeVpcs: jest.fn(async () => ({
      Vpcs: [
        {
          VpcId: VPC_ID,
          OwnerId: ACCOUNT_ID,
          IsDefault: true,
          State: 'available',
        },
      ],
    })),
    createSecurityGroup: jest.fn(async () => {
      throw new Error('mutation must remain unreachable');
    }),
    createNetworkAclEntry: jest.fn(async () => {
      throw new Error('mutation must remain unreachable');
    }),
    runInstances: jest.fn(async () => {
      throw new Error('mutation must remain unreachable');
    }),
    ...overrides,
  };
}

describe('AWS single-node read-only plan', () => {
  it('pins one deterministic public default substrate without mutation', async () => {
    const desired = makeDesired();
    const scope = providerScope();
    const api = makeApi();
    const first = await resolveAwsSingleNodePlan({
      desired,
      providerScope: scope,
      api,
    });
    const second = await resolveAwsSingleNodePlan({
      desired,
      providerScope: scope,
      api,
    });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      kind: 'awsSingleNodeDeploymentPlan',
      planId: expect.stringMatching(/^wsap1_[A-Za-z0-9_-]{43}$/u),
      deploymentInstanceId: desired.deploymentInstanceId,
      desired,
      providerSpec: {
        providerSpecId: expect.stringMatching(/^wsas1_[A-Za-z0-9_-]{43}$/u),
        providerScope: scope,
        vpc: { vpcId: VPC_ID },
        subnet: {
          subnetId: SUBNET_ID,
          availabilityZoneId: 'use2-az1',
          assignIpv6AddressOnCreation: false,
        },
        networkAcl: {
          networkAclId: NETWORK_ACL_ID,
          vpcId: VPC_ID,
          subnetId: SUBNET_ID,
          associationId: NETWORK_ACL_ASSOCIATION_ID,
          ipv4Ingress: {
            allowRuleNumber: 100,
            terminalDenyRuleNumber: 32767,
          },
          ipv4Egress: {
            allowRuleNumber: 100,
            terminalDenyRuleNumber: 32767,
          },
        },
        routeTable: {
          routeTableId: ROUTE_TABLE_ID,
          destinationCidrBlock: '0.0.0.0/0',
          internetGatewayId: INTERNET_GATEWAY_ID,
        },
        internetGateway: { internetGatewayId: INTERNET_GATEWAY_ID },
        image: {
          sourceParameter: {
            name: AWS_SINGLE_NODE_UBUNTU_PARAMETER,
            version: 42,
          },
          imageId: AMI_ID,
          ownerAccountId: '099720109477',
          architecture: 'x86_64',
          rootBlockDevice: {
            snapshotId: SNAPSHOT_ID,
            volumeType: 'gp3',
            sizeGiB: 8,
            sourceEncrypted: false,
            encrypted: true,
            deleteOnTermination: true,
          },
        },
        instanceType: AWS_SINGLE_NODE_INSTANCE_TYPE,
        ownedResourceCount: 3,
      },
      inspection: {
        status: 'absent',
        observedOwnedResourceCount: 0,
      },
      status: 'actionable',
      blockedReason: null,
    });
    expect(
      first.actions.map(
        (/** @type {Readonly<Record<string, any>>} */ action) => action.kind,
      ),
    ).toEqual(['provision-managed-node', 'activate-application']);
    expect(Object.isFrozen(first)).toBe(true);
    expect(api.createSecurityGroup).not.toHaveBeenCalled();
    expect(api.createNetworkAclEntry).not.toHaveBeenCalled();
    expect(api.runInstances).not.toHaveBeenCalled();
    expect(api.getParameter).toHaveBeenCalledWith({
      Name: AWS_SINGLE_NODE_UBUNTU_PARAMETER,
      WithDecryption: false,
    });
    expect(api.describeVpcs).toHaveBeenCalledWith({
      Filters: [{ Name: 'is-default', Values: ['true'] }],
      MaxResults: 100,
    });
    expect(api.describeNetworkAcls).toHaveBeenCalledWith({
      Filters: [
        { Name: 'association.subnet-id', Values: [SUBNET_ID] },
        { Name: 'vpc-id', Values: [VPC_ID] },
      ],
      MaxResults: 100,
    });
    const ownershipFilters = [
      { Name: 'tag:wharfie:managed-by', Values: ['wharfie'] },
      { Name: 'tag:wharfie:single-node-schema', Values: ['1'] },
      {
        Name: 'tag:wharfie:deployment-instance-id',
        Values: [desired.deploymentInstanceId],
      },
    ];
    expect(api.describeSecurityGroups).toHaveBeenNthCalledWith(1, {
      Filters: ownershipFilters,
      MaxResults: 1000,
    });
    expect(api.describeInstances).toHaveBeenNthCalledWith(1, {
      Filters: [
        ...ownershipFilters,
        {
          Name: 'instance-state-name',
          Values: [
            'pending',
            'running',
            'shutting-down',
            'stopping',
            'stopped',
          ],
        },
      ],
      MaxResults: 1000,
    });
    expect(api.describeVolumes).toHaveBeenNthCalledWith(1, {
      Filters: ownershipFilters,
      MaxResults: 500,
    });
    expect(api.describeInternetGateways).toHaveBeenCalledWith({
      Filters: [
        {
          Name: 'internet-gateway-id',
          Values: [INTERNET_GATEWAY_ID],
        },
        { Name: 'attachment.vpc-id', Values: [VPC_ID] },
      ],
      MaxResults: 100,
    });
  });

  it.each([false, true])(
    'separates observed source encryption (%s) from encrypted launch intent',
    async (sourceEncrypted) => {
      const image = imageResponse();
      image.Images[0].BlockDeviceMappings[0].Ebs.Encrypted = sourceEncrypted;
      const plan = await resolveAwsSingleNodePlan({
        desired: makeDesired(),
        providerScope: providerScope(),
        api: makeApi({
          describeImages: jest.fn(async () => image),
        }),
      });

      expect(plan.providerSpec.image.rootBlockDevice).toMatchObject({
        sourceEncrypted,
        encrypted: true,
      });
      expect(validateAwsSingleNodePlan(clone(plan))).toEqual(plan);
    },
  );

  it('invokes projected reads without exposing the original API receiver', async () => {
    /** @type {unknown} */
    let observedReceiver = 'not-called';
    const api = makeApi();
    api.describeVpcs = async function () {
      observedReceiver = this;
      if (typeof this?.runInstances === 'function') {
        await this.runInstances();
      }
      return {
        Vpcs: [
          {
            VpcId: VPC_ID,
            OwnerId: ACCOUNT_ID,
            IsDefault: true,
            State: 'available',
          },
        ],
      };
    };

    await resolveAwsSingleNodePlan({
      desired: makeDesired(),
      providerScope: providerScope(),
      api,
    });

    expect(observedReceiver).toBeUndefined();
    expect(api.runInstances).not.toHaveBeenCalled();
  });

  it('selects the first canonical default subnet where t3.small is offered', async () => {
    const api = makeApi({
      describeInstanceTypeOfferings: jest.fn(async () => ({
        InstanceTypeOfferings: [
          {
            InstanceType: AWS_SINGLE_NODE_INSTANCE_TYPE,
            Location: 'use2-az2',
          },
        ],
      })),
      describeSubnets: jest.fn(async () => ({
        Subnets: [
          {
            SubnetId: 'subnet-11111111111111111',
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
          {
            SubnetId: 'subnet-22222222222222222',
            VpcId: VPC_ID,
            OwnerId: ACCOUNT_ID,
            State: 'available',
            DefaultForAz: true,
            MapPublicIpOnLaunch: true,
            AssignIpv6AddressOnCreation: false,
            Ipv6Native: false,
            AvailableIpAddressCount: 4091,
            AvailabilityZone: 'us-east-2b',
            AvailabilityZoneId: 'use2-az2',
          },
        ],
      })),
    });
    const plan = await resolveAwsSingleNodePlan({
      desired: makeDesired(),
      providerScope: providerScope(),
      api,
    });

    expect(plan.providerSpec.subnet).toMatchObject({
      subnetId: 'subnet-22222222222222222',
      availabilityZoneId: 'use2-az2',
    });
    expect(api.describeInstanceTypeOfferings).toHaveBeenCalledWith({
      LocationType: 'availability-zone-id',
      Filters: [
        { Name: 'instance-type', Values: [AWS_SINGLE_NODE_INSTANCE_TYPE] },
      ],
      MaxResults: 1000,
    });
  });

  it.each([
    ['missing', undefined],
    ['non-boolean', 'false'],
  ])(
    'rejects %s subnet IPv6 auto-assignment evidence',
    async (_name, assignIpv6AddressOnCreation) => {
      const subnet = {
        SubnetId: SUBNET_ID,
        VpcId: VPC_ID,
        OwnerId: ACCOUNT_ID,
        State: 'available',
        DefaultForAz: true,
        MapPublicIpOnLaunch: true,
        AssignIpv6AddressOnCreation: assignIpv6AddressOnCreation,
        Ipv6Native: false,
        AvailableIpAddressCount: 4091,
        AvailabilityZone: 'us-east-2a',
        AvailabilityZoneId: 'use2-az1',
      };
      if (assignIpv6AddressOnCreation === undefined) {
        Reflect.deleteProperty(subnet, 'AssignIpv6AddressOnCreation');
      }

      await expect(
        resolveAwsSingleNodePlan({
          desired: makeDesired(),
          providerScope: providerScope(),
          api: makeApi({
            describeSubnets: jest.fn(async () => ({ Subnets: [subnet] })),
          }),
        }),
      ).rejects.toBeInstanceOf(AwsSingleNodePlanEvidenceError);
    },
  );

  it('skips structurally valid unsuitable default subnets', async () => {
    const selectedSubnetId = 'subnet-44444444444444444';
    const api = makeApi({
      describeSubnets: jest.fn(async () => ({
        Subnets: [
          {
            SubnetId: 'subnet-11111111111111111',
            VpcId: VPC_ID,
            OwnerId: ACCOUNT_ID,
            State: 'available',
            DefaultForAz: true,
            MapPublicIpOnLaunch: false,
            AssignIpv6AddressOnCreation: false,
            Ipv6Native: false,
            AvailableIpAddressCount: 4091,
            AvailabilityZone: 'us-east-2a',
            AvailabilityZoneId: 'use2-az1',
          },
          {
            SubnetId: 'subnet-22222222222222222',
            VpcId: VPC_ID,
            OwnerId: ACCOUNT_ID,
            State: 'available',
            DefaultForAz: true,
            MapPublicIpOnLaunch: true,
            AssignIpv6AddressOnCreation: false,
            Ipv6Native: true,
            AvailableIpAddressCount: 4091,
            AvailabilityZone: 'us-east-2a',
            AvailabilityZoneId: 'use2-az1',
          },
          {
            SubnetId: 'subnet-33333333333333333',
            VpcId: VPC_ID,
            OwnerId: ACCOUNT_ID,
            State: 'available',
            DefaultForAz: true,
            MapPublicIpOnLaunch: true,
            AssignIpv6AddressOnCreation: false,
            Ipv6Native: false,
            AvailableIpAddressCount: 0,
            AvailabilityZone: 'us-east-2a',
            AvailabilityZoneId: 'use2-az1',
          },
          {
            SubnetId: 'subnet-55555555555555555',
            VpcId: VPC_ID,
            OwnerId: ACCOUNT_ID,
            State: 'available',
            DefaultForAz: true,
            MapPublicIpOnLaunch: true,
            AssignIpv6AddressOnCreation: true,
            Ipv6Native: false,
            AvailableIpAddressCount: 4091,
            AvailabilityZone: 'us-east-2a',
            AvailabilityZoneId: 'use2-az1',
          },
          {
            SubnetId: selectedSubnetId,
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
      })),
    });

    const plan = await resolveAwsSingleNodePlan({
      desired: makeDesired(),
      providerScope: providerScope(),
      api,
    });

    expect(plan.providerSpec.subnet.subnetId).toBe(selectedSubnetId);
  });

  it('uses an explicit subnet route table instead of a conflicting main table', async () => {
    const explicitRouteTableId = 'rtb-11111111111111111';
    const api = makeApi({
      describeRouteTables: jest.fn(async () => ({
        RouteTables: [
          {
            RouteTableId: ROUTE_TABLE_ID,
            VpcId: VPC_ID,
            OwnerId: ACCOUNT_ID,
            Associations: [{ Main: true }],
            Routes: [
              { DestinationCidrBlock: '10.0.0.0/16', GatewayId: 'local' },
            ],
          },
          {
            RouteTableId: explicitRouteTableId,
            VpcId: VPC_ID,
            OwnerId: ACCOUNT_ID,
            Associations: [
              {
                Main: false,
                SubnetId: SUBNET_ID,
                AssociationState: { State: 'associated' },
              },
            ],
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
      })),
    });
    const plan = await resolveAwsSingleNodePlan({
      desired: makeDesired(),
      providerScope: providerScope(),
      api,
    });

    expect(plan.providerSpec.routeTable.routeTableId).toBe(
      explicitRouteTableId,
    );
  });

  it.each([
    ['missing', { NetworkAcls: [] }],
    [
      'ambiguous',
      {
        NetworkAcls: [
          ...networkAclResponse().NetworkAcls,
          {
            ...networkAclResponse().NetworkAcls[0],
            NetworkAclId: 'acl-11111111111111111',
          },
        ],
      },
    ],
  ])(
    'rejects %s effective network ACL associations',
    async (_name, response) => {
      await expect(
        resolveAwsSingleNodePlan({
          desired: makeDesired(),
          providerScope: providerScope(),
          api: makeApi({
            describeNetworkAcls: jest.fn(async () => response),
          }),
        }),
      ).rejects.toBeInstanceOf(AwsSingleNodePlanEvidenceError);
    },
  );

  it.each([
    [
      'missing',
      () => {
        const response = networkAclResponse();
        response.NetworkAcls[0].Associations = [];
        return response;
      },
    ],
    [
      'ambiguous',
      () => {
        const response = networkAclResponse();
        response.NetworkAcls[0].Associations.push({
          ...response.NetworkAcls[0].Associations[0],
          NetworkAclAssociationId: 'aclassoc-11111111111111111',
        });
        return response;
      },
    ],
  ])(
    'rejects %s selected-subnet network ACL association evidence',
    async (_name, responseFactory) => {
      await expect(
        resolveAwsSingleNodePlan({
          desired: makeDesired(),
          providerScope: providerScope(),
          api: makeApi({
            describeNetworkAcls: jest.fn(async () => responseFactory()),
          }),
        }),
      ).rejects.toBeInstanceOf(AwsSingleNodePlanEvidenceError);
    },
  );

  it('rejects accessor-backed network ACL association evidence', async () => {
    const response = networkAclResponse();
    const association = response.NetworkAcls[0].Associations[0];
    Object.defineProperty(association, 'SubnetId', {
      enumerable: true,
      get() {
        return SUBNET_ID;
      },
    });

    await expect(
      resolveAwsSingleNodePlan({
        desired: makeDesired(),
        providerScope: providerScope(),
        api: makeApi({
          describeNetworkAcls: jest.fn(async () => response),
        }),
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodePlanEvidenceError);
  });

  it('rejects a lower-numbered IPv4 deny ahead of allow-all', async () => {
    const response = networkAclResponse();
    response.NetworkAcls[0].Entries.unshift({
      RuleNumber: 50,
      Protocol: '-1',
      RuleAction: 'deny',
      Egress: false,
      CidrBlock: '0.0.0.0/0',
    });

    await expect(
      resolveAwsSingleNodePlan({
        desired: makeDesired(),
        providerScope: providerScope(),
        api: makeApi({
          describeNetworkAcls: jest.fn(async () => response),
        }),
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodePlanEvidenceError);
  });

  it('rejects custom IPv4 rules even after allow-all', async () => {
    const response = networkAclResponse();
    response.NetworkAcls[0].Entries.push({
      RuleNumber: 200,
      Protocol: '6',
      RuleAction: 'allow',
      Egress: false,
      CidrBlock: '203.0.113.0/24',
      PortRange: { From: 22, To: 22 },
    });

    await expect(
      resolveAwsSingleNodePlan({
        desired: makeDesired(),
        providerScope: providerScope(),
        api: makeApi({
          describeNetworkAcls: jest.fn(async () => response),
        }),
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodePlanEvidenceError);
  });

  it('rejects equal-number IPv4 allow and terminal deny rules', async () => {
    const response = networkAclResponse();
    const ingressAllow = response.NetworkAcls[0].Entries.find(
      /** @param {Record<string, any>} entry */
      (entry) =>
        entry.Egress === false &&
        entry.RuleNumber === 100 &&
        entry.CidrBlock === '0.0.0.0/0',
    );
    if (ingressAllow === undefined) throw new Error('test fixture is invalid');
    ingressAllow.RuleNumber = 32767;

    await expect(
      resolveAwsSingleNodePlan({
        desired: makeDesired(),
        providerScope: providerScope(),
        api: makeApi({
          describeNetworkAcls: jest.fn(async () => response),
        }),
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodePlanEvidenceError);
  });

  it('rejects network ACL evidence without IPv4 allow-all', async () => {
    const response = networkAclResponse();
    const ingressAllow = response.NetworkAcls[0].Entries.find(
      /** @param {Record<string, any>} entry */
      (entry) =>
        entry.Egress === false &&
        entry.RuleNumber === 100 &&
        entry.CidrBlock === '0.0.0.0/0',
    );
    if (ingressAllow === undefined) throw new Error('test fixture is invalid');
    ingressAllow.RuleAction = 'deny';

    await expect(
      resolveAwsSingleNodePlan({
        desired: makeDesired(),
        providerScope: providerScope(),
        api: makeApi({
          describeNetworkAcls: jest.fn(async () => response),
        }),
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodePlanEvidenceError);
  });

  it('reads the complete bounded network ACL result before accepting it', async () => {
    const describeNetworkAcls = jest
      .fn(
        /**
         * @param {Record<string, any>} _request
         * @returns {Promise<Record<string, any>>}
         */
        async (_request) => ({ NetworkAcls: [] }),
      )
      .mockResolvedValueOnce({
        NetworkAcls: [],
        NextToken: 'network-acl-page-two',
      })
      .mockResolvedValueOnce(networkAclResponse());

    await resolveAwsSingleNodePlan({
      desired: makeDesired(),
      providerScope: providerScope(),
      api: makeApi({ describeNetworkAcls }),
    });

    expect(describeNetworkAcls).toHaveBeenNthCalledWith(2, {
      Filters: [
        { Name: 'association.subnet-id', Values: [SUBNET_ID] },
        { Name: 'vpc-id', Values: [VPC_ID] },
      ],
      MaxResults: 100,
      NextToken: 'network-acl-page-two',
    });
  });

  it('rejects a repeated network ACL pagination token', async () => {
    const describeNetworkAcls = jest
      .fn(
        /**
         * @param {Record<string, any>} _request
         * @returns {Promise<Record<string, any>>}
         */
        async (_request) => ({ NetworkAcls: [] }),
      )
      .mockResolvedValueOnce({
        NetworkAcls: [],
        NextToken: 'same-network-acl-token',
      })
      .mockResolvedValueOnce({
        NetworkAcls: [],
        NextToken: 'same-network-acl-token',
      });

    await expect(
      resolveAwsSingleNodePlan({
        desired: makeDesired(),
        providerScope: providerScope(),
        api: makeApi({ describeNetworkAcls }),
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodePlanEvidenceError);
    expect(describeNetworkAcls).toHaveBeenCalledTimes(2);
  });

  it('rejects IPv6-only network ACL evidence', async () => {
    const response = networkAclResponse();
    response.NetworkAcls[0].Entries = response.NetworkAcls[0].Entries.filter(
      /** @param {Record<string, any>} entry */
      (entry) => entry.CidrBlock === undefined,
    );

    await expect(
      resolveAwsSingleNodePlan({
        desired: makeDesired(),
        providerScope: providerScope(),
        api: makeApi({
          describeNetworkAcls: jest.fn(async () => response),
        }),
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodePlanEvidenceError);
  });

  it('blocks fresh planning on any deployment-owned provider residue', async () => {
    const sentinel = 'provider-response-field-must-not-leak';
    const api = makeApi({
      describeSecurityGroups: jest.fn(async () => ({
        SecurityGroups: [
          {
            GroupId: 'sg-0123456789abcdef0',
            Description: sentinel,
          },
        ],
      })),
    });
    const plan = await resolveAwsSingleNodePlan({
      desired: makeDesired(),
      providerScope: providerScope(),
      api,
    });

    expect(plan).toMatchObject({
      status: 'blocked',
      blockedReason: 'unbound-provider-resources',
      inspection: {
        status: 'unbound-conflict',
        observedOwnedResourceCount: 1,
      },
      actions: [],
    });
    expect(JSON.stringify(plan)).not.toContain(sentinel);
  });

  it('reads all ownership pages and deduplicates resource identifiers', async () => {
    const groupId = 'sg-0123456789abcdef0';
    const describeSecurityGroups = jest
      .fn(
        /**
         * @param {Record<string, any>} _request
         * @returns {Promise<Record<string, any>>}
         */
        async (_request) => ({ SecurityGroups: [] }),
      )
      .mockResolvedValueOnce({
        SecurityGroups: [{ GroupId: groupId }],
        NextToken: 'page-two',
      })
      .mockResolvedValueOnce({
        SecurityGroups: [{ GroupId: groupId }],
      });
    const desired = makeDesired();
    const api = makeApi({ describeSecurityGroups });

    const plan = await resolveAwsSingleNodePlan({
      desired,
      providerScope: providerScope(),
      api,
    });

    expect(plan).toMatchObject({
      status: 'blocked',
      blockedReason: 'unbound-provider-resources',
      inspection: {
        status: 'unbound-conflict',
        observedOwnedResourceCount: 1,
      },
    });
    expect(describeSecurityGroups).toHaveBeenNthCalledWith(2, {
      Filters: [
        { Name: 'tag:wharfie:managed-by', Values: ['wharfie'] },
        { Name: 'tag:wharfie:single-node-schema', Values: ['1'] },
        {
          Name: 'tag:wharfie:deployment-instance-id',
          Values: [desired.deploymentInstanceId],
        },
      ],
      MaxResults: 1000,
      NextToken: 'page-two',
    });
  });

  it('fails closed when an ownership paginator repeats a token', async () => {
    const describeVolumes = jest
      .fn(
        /**
         * @param {Record<string, any>} _request
         * @returns {Promise<Record<string, any>>}
         */
        async (_request) => ({ Volumes: [] }),
      )
      .mockResolvedValueOnce({ Volumes: [], NextToken: 'same-token' })
      .mockResolvedValueOnce({ Volumes: [], NextToken: 'same-token' });

    await expect(
      resolveAwsSingleNodePlan({
        desired: makeDesired(),
        providerScope: providerScope(),
        api: makeApi({ describeVolumes }),
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodePlanEvidenceError);
    expect(describeVolumes).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'default VPC',
      {
        describeVpcs: jest.fn(async () => ({ Vpcs: [] })),
      },
    ],
    [
      'subnet ownership',
      {
        describeSubnets: jest.fn(async () => ({
          Subnets: [
            {
              SubnetId: SUBNET_ID,
              VpcId: VPC_ID,
              OwnerId: '999999999999',
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
        })),
      },
    ],
    [
      'public subnet',
      {
        describeSubnets: jest.fn(async () => ({
          Subnets: [
            {
              SubnetId: SUBNET_ID,
              VpcId: VPC_ID,
              OwnerId: ACCOUNT_ID,
              State: 'available',
              DefaultForAz: true,
              MapPublicIpOnLaunch: false,
              AssignIpv6AddressOnCreation: false,
              Ipv6Native: false,
              AvailableIpAddressCount: 4091,
              AvailabilityZone: 'us-east-2a',
              AvailabilityZoneId: 'use2-az1',
            },
          ],
        })),
      },
    ],
    [
      'internet route',
      {
        describeRouteTables: jest.fn(async () => ({
          RouteTables: [
            {
              RouteTableId: ROUTE_TABLE_ID,
              VpcId: VPC_ID,
              OwnerId: ACCOUNT_ID,
              Associations: [{ Main: true }],
              Routes: [],
            },
          ],
        })),
      },
    ],
    [
      'Ubuntu image',
      {
        describeImages: jest.fn(async () => ({
          Images: [{ ...imageResponse().Images[0], Architecture: 'arm64' }],
        })),
      },
    ],
  ])('fails closed on invalid %s evidence', async (_name, overrides) => {
    await expect(
      resolveAwsSingleNodePlan({
        desired: makeDesired(),
        providerScope: providerScope(),
        api: makeApi(overrides),
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodePlanEvidenceError);
  });

  it('validates serialized plans and rejects changed provider selection', async () => {
    const plan = await resolveAwsSingleNodePlan({
      desired: makeDesired(),
      providerScope: providerScope(),
      api: makeApi(),
    });
    const serialized = clone(plan);

    expect(validateAwsSingleNodePlan(serialized)).toEqual(plan);
    serialized.providerSpec.subnet.subnetId = 'subnet-99999999999999999';
    expect(() => validateAwsSingleNodePlan(serialized)).toThrow(
      /networkAcl references conflict|providerSpecId does not match/iu,
    );
    const enabledIpv6AutoAssignment = clone(plan);
    enabledIpv6AutoAssignment.providerSpec.subnet.assignIpv6AddressOnCreation = true;
    expect(() => validateAwsSingleNodePlan(enabledIpv6AutoAssignment)).toThrow(
      /subnet is invalid/iu,
    );
    const changedNetworkAcl = clone(plan);
    changedNetworkAcl.providerSpec.networkAcl.ipv4Ingress.allowRuleNumber = 99;
    expect(() => validateAwsSingleNodePlan(changedNetworkAcl)).toThrow(
      /providerSpecId does not match/iu,
    );
    const changedSourceEncryption = clone(plan);
    changedSourceEncryption.providerSpec.image.rootBlockDevice.sourceEncrypted = true;
    expect(() => validateAwsSingleNodePlan(changedSourceEncryption)).toThrow(
      /providerSpecId does not match/iu,
    );
    const disabledLaunchEncryption = clone(plan);
    disabledLaunchEncryption.providerSpec.image.rootBlockDevice.encrypted = false;
    expect(() => validateAwsSingleNodePlan(disabledLaunchEncryption)).toThrow(
      /image is invalid/iu,
    );
  });

  it('sanitizes provider read failures and rejects public credential fields', async () => {
    const sentinel = 'raw-provider-secret-sentinel';
    const api = makeApi({
      describeVpcs: jest.fn(async () => {
        throw new Error(sentinel);
      }),
    });
    let readFailure;
    try {
      await resolveAwsSingleNodePlan({
        desired: makeDesired(),
        providerScope: providerScope(),
        api,
      });
    } catch (error) {
      readFailure = error;
    }
    expect(readFailure).toBeInstanceOf(AwsSingleNodePlanReadError);
    expect(String(readFailure)).not.toContain(sentinel);

    let admissionFailure;
    try {
      await resolveAwsSingleNodePlan({
        desired: makeDesired(),
        providerScope: providerScope(),
        api: makeApi(),
        accessKeyId: sentinel,
      });
    } catch (error) {
      admissionFailure = error;
    }
    expect(admissionFailure).toBeInstanceOf(TypeError);
    expect(String(admissionFailure)).not.toContain(sentinel);
  });
});
