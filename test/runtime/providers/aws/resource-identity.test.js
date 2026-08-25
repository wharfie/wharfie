import { createHash } from 'node:crypto';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { createApplicationRevision } from '../../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../../src/core/runtime/artifact-record.js';
import { sortCanonicalJsonValue } from '../../../../src/core/runtime/canonical-order.js';
import { sha256Base64Url } from '../../../../src/core/runtime/content-id.js';
import { createAwsProviderScope } from '../../../../src/core/runtime/deployment-provider-scope.js';
import {
  AWS_SINGLE_NODE_RESOURCE_ROLES,
  AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
  createAwsSingleNodeResourceIdentity,
  createAwsSingleNodeRunInstancesClientToken,
} from '../../../../src/core/runtime/providers/aws/resource-identity.js';
import { createAwsSingleNodeProvisioningIntent } from '../../../../src/core/runtime/providers/aws/single-node-provisioning-intent.js';
import {
  AWS_SINGLE_NODE_INSTANCE_TYPE,
  resolveAwsSingleNodePlan,
} from '../../../../src/core/runtime/providers/aws/single-node-plan.js';
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
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const NAME_PREFIXES = Object.freeze({
  securityGroup: 'wharfie-sn-sg-',
  instance: 'wharfie-sn-node-',
  rootVolume: 'wharfie-sn-root-',
});
const ROLE_SLUGS = Object.freeze({
  securityGroup: 'security-group',
  instance: 'instance',
  rootVolume: 'root-volume',
});

/** @type {Readonly<Record<string, any>>} */
let provisioningIntent;

beforeAll(async () => {
  const plan = await resolveAwsSingleNodePlan({
    desired: makeDesired(),
    providerScope: createAwsProviderScope({
      partition: 'aws',
      accountId: ACCOUNT_ID,
      region: REGION,
    }),
    api: makeReadApi(),
  });
  provisioningIntent = createAwsSingleNodeProvisioningIntent({
    plan,
    incarnationId: createSingleNodeDeploymentIncarnationId(
      Buffer.alloc(32, 37),
    ),
    cloudInitDigest: digest('#cloud-config\n'),
  });
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

/**
 * Independent expectation for one domain-separated canonical base digest.
 * @param {string} domain
 * @param {Readonly<Record<string, string>>} base
 * @param {'base64url'|'hex'} encoding
 */
function expectedDigest(domain, base, encoding) {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(JSON.stringify(sortCanonicalJsonValue(base)), 'utf8')
    .digest(encoding);
}

/** @param {any} value @returns {boolean} */
function deeplyFrozen(value) {
  return (
    value === null ||
    typeof value !== 'object' ||
    (Object.isFrozen(value) && Object.values(value).every(deeplyFrozen))
  );
}

describe('AWS single-node deterministic resource identity', () => {
  it('derives exact names, nonces, state digests, tags, and client token', () => {
    const identities = Object.fromEntries(
      AWS_SINGLE_NODE_RESOURCE_ROLES.map((role) => [
        role,
        createAwsSingleNodeResourceIdentity(provisioningIntent, role),
      ]),
    );
    const provisionAction = provisioningIntent.plan.actions.find(
      (/** @type {Readonly<Record<string, any>>} */ action) =>
        action.kind === 'provision-managed-node',
    );
    if (provisionAction === undefined) {
      throw new Error('test provisioning action is missing');
    }

    for (const roleValue of AWS_SINGLE_NODE_RESOURCE_ROLES) {
      const role = /** @type {keyof typeof ROLE_SLUGS} */ (roleValue);
      const identity = identities[role];
      expect(identity.base).toEqual({
        provisioningIntentId: provisioningIntent.provisioningIntentId,
        planId: provisioningIntent.plan.planId,
        actionId: provisionAction.actionId,
        deploymentInstanceId: provisioningIntent.plan.deploymentInstanceId,
        incarnationId: provisioningIntent.incarnationId,
        providerScopeId:
          provisioningIntent.plan.providerSpec.providerScope.providerScopeId,
        role,
      });
      expect(identity.ownershipNonce).toBe(
        expectedDigest(
          'wharfie:aws-single-node-resource-ownership-nonce:v1',
          identity.base,
          'base64url',
        ),
      );
      expect(identity.stateDigest).toBe(
        expectedDigest(
          `wharfie:aws-single-node-resource-state:${ROLE_SLUGS[role]}:v1`,
          identity.base,
          'base64url',
        ),
      );
      expect(identity.name).toBe(
        `${NAME_PREFIXES[role]}${expectedDigest(
          'wharfie:aws-single-node-resource-name:v1',
          identity.base,
          'hex',
        )}`,
      );
      expect(identity.name).toMatch(
        new RegExp(`^${NAME_PREFIXES[role]}[0-9a-f]{64}$`, 'u'),
      );
      expect(identity.name.length).toBeLessThanOrEqual(255);
      expect(identity.ownershipNonce).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(identity.stateDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(
        identity.tags.map(
          (/** @type {{Key: string, Value: string}} */ tag) => tag.Key,
        ),
      ).toEqual([
        'Name',
        'wharfie:created-by-action-id',
        'wharfie:deployment-instance-id',
        'wharfie:incarnation-id',
        'wharfie:managed-by',
        'wharfie:ownership-nonce',
        'wharfie:resource-role',
        'wharfie:single-node-schema',
        'wharfie:state-digest',
      ]);
      expect(
        Object.fromEntries(
          identity.tags.map(
            (/** @type {{Key: string, Value: string}} */ tag) => [
              tag.Key,
              tag.Value,
            ],
          ),
        ),
      ).toMatchObject({
        Name: identity.name,
        'wharfie:created-by-action-id': provisionAction.actionId,
        'wharfie:deployment-instance-id':
          provisioningIntent.plan.deploymentInstanceId,
        'wharfie:incarnation-id': provisioningIntent.incarnationId,
        'wharfie:managed-by': 'wharfie',
        'wharfie:ownership-nonce': identity.ownershipNonce,
        'wharfie:resource-role': role,
        'wharfie:single-node-schema': '1',
        'wharfie:state-digest': identity.stateDigest,
      });
      expect(
        identity.tags.every(
          (/** @type {{Key: string, Value: string}} */ tag) =>
            tag.Key.length <= 128 && tag.Value.length <= 256,
        ),
      ).toBe(true);
      expect(deeplyFrozen(identity)).toBe(true);
      expect(JSON.stringify(identity)).not.toMatch(
        /secret|credential|private.key|access.key/iu,
      );
    }

    const clientToken =
      createAwsSingleNodeRunInstancesClientToken(provisioningIntent);
    expect(clientToken).toBe(
      expectedDigest(
        'wharfie:aws-single-node-run-instances-client-token:v1',
        identities.instance.base,
        'hex',
      ),
    );
    expect(clientToken).toMatch(/^[0-9a-f]{64}$/u);
    expect(AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION).toBe(
      'Wharfie single-node security group.',
    );
  });

  it('is deterministic and distinct across roles, incarnations, and purposes', () => {
    const first = AWS_SINGLE_NODE_RESOURCE_ROLES.map((role) =>
      createAwsSingleNodeResourceIdentity(provisioningIntent, role),
    );
    const replay = AWS_SINGLE_NODE_RESOURCE_ROLES.map((role) =>
      createAwsSingleNodeResourceIdentity(clone(provisioningIntent), role),
    );
    expect(replay).toEqual(first);
    expect(new Set(first.map((identity) => identity.name)).size).toBe(3);
    expect(new Set(first.map((identity) => identity.ownershipNonce)).size).toBe(
      3,
    );
    expect(new Set(first.map((identity) => identity.stateDigest)).size).toBe(3);

    const token =
      createAwsSingleNodeRunInstancesClientToken(provisioningIntent);
    const instanceNameHash = first[1].name.slice(NAME_PREFIXES.instance.length);
    expect(token).not.toBe(instanceNameHash);

    const nextIntent = createAwsSingleNodeProvisioningIntent({
      plan: provisioningIntent.plan,
      incarnationId: createSingleNodeDeploymentIncarnationId(
        Buffer.alloc(32, 41),
      ),
      cloudInitDigest: provisioningIntent.cloudInitDigest,
    });
    for (const role of AWS_SINGLE_NODE_RESOURCE_ROLES) {
      const before = createAwsSingleNodeResourceIdentity(
        provisioningIntent,
        role,
      );
      const after = createAwsSingleNodeResourceIdentity(nextIntent, role);
      expect(after.name).not.toBe(before.name);
      expect(after.ownershipNonce).not.toBe(before.ownershipNonce);
      expect(after.stateDigest).not.toBe(before.stateDigest);
    }
    expect(createAwsSingleNodeRunInstancesClientToken(nextIntent)).not.toBe(
      token,
    );
  });

  it('rejects unknown roles and tampered provisioning authority', () => {
    expect(() =>
      createAwsSingleNodeResourceIdentity(provisioningIntent, 'database'),
    ).toThrow(/role is unsupported/iu);

    const tamperedScope = /** @type {any} */ (clone(provisioningIntent));
    tamperedScope.plan.providerSpec.providerScope.accountId = '999999999999';
    expect(() =>
      createAwsSingleNodeResourceIdentity(tamperedScope, 'instance'),
    ).toThrow();
    expect(() =>
      createAwsSingleNodeRunInstancesClientToken(tamperedScope),
    ).toThrow();

    const tamperedIntentId = /** @type {any} */ (clone(provisioningIntent));
    tamperedIntentId.provisioningIntentId =
      tamperedIntentId.provisioningIntentId.replace(/.$/u, 'A');
    expect(() =>
      createAwsSingleNodeResourceIdentity(tamperedIntentId, 'securityGroup'),
    ).toThrow();
  });
});
