import { describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../../../src/core/runtime/content-id.js';
import { createAwsProviderScope } from '../../../../src/core/runtime/deployment-provider-scope.js';
import { createAwsSingleNodePreviewFactory } from '../../../../src/core/runtime/providers/aws/single-node-preview.js';
import {
  AWS_SINGLE_NODE_INSTANCE_TYPE,
  AWS_SINGLE_NODE_UBUNTU_OWNER_ACCOUNT_ID,
  resolveAwsSingleNodePlan,
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
const PLAN_READ_METHODS = Object.freeze([
  'describeImages',
  'describeInstanceTypeOfferings',
  'describeInstances',
  'describeInternetGateways',
  'describeNetworkAcls',
  'describeRouteTables',
  'describeSecurityGroups',
  'describeSubnets',
  'describeVolumes',
  'describeVpcs',
]);

/** @param {string|Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {'aws'|'hetzner'} [provider] */
function makeDesired(provider = 'aws') {
  const revision = createApplicationRevision({
    contract: {
      schemaVersion: 4,
      app: { id: 'hello-app' },
      cli: {
        entrypoint: { kind: 'node', path: 'src/cli.js', export: 'main' },
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
    provider:
      provider === 'aws'
        ? { kind: 'aws', region: REGION }
        : { kind: 'hetzner', location: 'fsn1' },
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

/** @param {string} [accountId] */
function providerScope(accountId = ACCOUNT_ID) {
  return createAwsProviderScope({
    partition: 'aws',
    accountId,
    region: REGION,
  });
}

function networkAclResponse() {
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
        Entries: [
          {
            RuleNumber: 100,
            Protocol: '-1',
            RuleAction: 'allow',
            Egress: false,
            CidrBlock: '0.0.0.0/0',
          },
          {
            RuleNumber: 32767,
            Protocol: '-1',
            RuleAction: 'deny',
            Egress: false,
            CidrBlock: '0.0.0.0/0',
          },
          {
            RuleNumber: 100,
            Protocol: '-1',
            RuleAction: 'allow',
            Egress: true,
            CidrBlock: '0.0.0.0/0',
          },
          {
            RuleNumber: 32767,
            Protocol: '-1',
            RuleAction: 'deny',
            Egress: true,
            CidrBlock: '0.0.0.0/0',
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
    describeImages: jest.fn(async () => ({
      Images: [
        {
          ImageId: AMI_ID,
          Name: 'ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-20260701',
          CreationDate: '2026-07-02T12:34:56.000Z',
          OwnerId: AWS_SINGLE_NODE_UBUNTU_OWNER_ACCOUNT_ID,
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
    })),
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
    describeNetworkAcls: jest.fn(async () => networkAclResponse()),
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
    runInstances: jest.fn(async () => {
      throw new Error('mutation must remain unreachable');
    }),
    ...overrides,
  };
}

/**
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function makeAuthority(overrides = {}) {
  const scope = providerScope();
  return {
    schemaVersion: 1,
    kind: 'awsSingleNodeReadAuthority',
    providerScope: scope,
    api: makeApi(),
    resolveScope: jest.fn(async () => scope),
    close: jest.fn(async () => {}),
    ...overrides,
  };
}

describe('AWS single-node provider preview', () => {
  it('returns the canonical plan through a re-authenticated read-only projection', async () => {
    const desired = makeDesired();
    const scope = providerScope();
    const expected = await resolveAwsSingleNodePlan({
      desired,
      providerScope: scope,
      api: makeApi(),
    });
    const authority = makeAuthority();
    const createReadAuthority = jest.fn(
      /** @param {Record<string, any>} _value */
      async (_value) => authority,
    );
    const resolvePlan = jest.fn(
      /** @param {Record<string, any>} value */
      async (value) => {
        expect(Object.keys(value.api).sort()).toEqual(
          [...PLAN_READ_METHODS].sort(),
        );
        expect(value.api.createSecurityGroup).toBeUndefined();
        expect(value.api.runInstances).toBeUndefined();
        expect(value.providerScope).toEqual(scope);
        return expected;
      },
    );
    const preview = createAwsSingleNodePreviewFactory({
      createReadAuthority,
      resolvePlan,
    });

    await expect(preview({ desired })).resolves.toEqual(expected);

    expect(createReadAuthority).toHaveBeenCalledWith({ region: REGION });
    expect(authority.resolveScope).toHaveBeenCalledTimes(1);
    expect(resolvePlan).toHaveBeenCalledTimes(1);
    expect(authority.close).toHaveBeenCalledTimes(1);
    expect(authority.api.createSecurityGroup).not.toHaveBeenCalled();
    expect(authority.api.runInstances).not.toHaveBeenCalled();
  });

  it('closes the authority when planning fails', async () => {
    const authority = makeAuthority();
    const preview = createAwsSingleNodePreviewFactory({
      createReadAuthority: jest.fn(async () => authority),
      resolvePlan: jest.fn(async () => {
        throw new Error('safe planning failure');
      }),
    });

    await expect(preview({ desired: makeDesired() })).rejects.toThrow(
      'safe planning failure',
    );
    expect(authority.close).toHaveBeenCalledTimes(1);
  });

  it('closes and rejects when credential scope changes during planning', async () => {
    const authority = makeAuthority({
      resolveScope: jest.fn(async () => providerScope('999999999999')),
    });
    const resolvePlan = jest.fn();
    const preview = createAwsSingleNodePreviewFactory({
      createReadAuthority: jest.fn(async () => authority),
      resolvePlan,
    });

    await expect(preview({ desired: makeDesired() })).rejects.toThrow(
      /credential scope changed/iu,
    );
    expect(resolvePlan).not.toHaveBeenCalled();
    expect(authority.close).toHaveBeenCalledTimes(1);
  });

  it('retains both planning and cleanup failures without retrying close', async () => {
    const authority = makeAuthority({
      close: jest.fn(async () => {
        throw new Error('safe close failure');
      }),
    });
    const preview = createAwsSingleNodePreviewFactory({
      createReadAuthority: jest.fn(async () => authority),
      resolvePlan: jest.fn(async () => {
        throw new Error('safe planning failure');
      }),
    });

    await expect(preview({ desired: makeDesired() })).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [
        expect.objectContaining({ message: 'safe planning failure' }),
        expect.objectContaining({ message: 'safe close failure' }),
      ],
    });
    expect(authority.close).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-AWS desired state before opening credentials', async () => {
    const createReadAuthority = jest.fn();
    const preview = createAwsSingleNodePreviewFactory({
      createReadAuthority,
      resolvePlan: jest.fn(),
    });

    await expect(preview({ desired: makeDesired('hetzner') })).rejects.toThrow(
      /must target AWS/iu,
    );
    expect(createReadAuthority).not.toHaveBeenCalled();
  });
});
