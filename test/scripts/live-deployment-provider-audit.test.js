import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import { createLiveDeploymentCleanupAuditor } from '../../scripts/live-deployment-provider-audit.js';
import { sha256Base64Url } from '../../src/core/runtime/content-id.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import { getAwsSingleNodeDeploymentInventoryFilters } from '../../src/core/runtime/providers/aws/ownership.js';
import {
  createAwsProvisionedResourceRecord,
  createAwsProvisioningMutationAttempt,
} from '../../src/core/runtime/providers/aws/single-node-journal-evidence.js';
import { resolveAwsSingleNodePlan } from '../../src/core/runtime/providers/aws/single-node-plan.js';
import { createAwsSingleNodeProvisioningIntent } from '../../src/core/runtime/providers/aws/single-node-provisioning-intent.js';
import { HetznerApiError } from '../../src/core/runtime/providers/hetzner/api-client.js';
import { getHetznerDeploymentLabelSelector } from '../../src/core/runtime/providers/hetzner/ownership.js';
import { createHetznerProvisioningMutationAttempt } from '../../src/core/runtime/providers/hetzner/single-node-provisioning.js';
import { createSingleNodeDeploymentDesired } from '../../src/core/runtime/single-node-deployment-desired.js';
import { createSingleNodeDeploymentIntent } from '../../src/core/runtime/single-node-deployment-intent.js';
import {
  advanceSingleNodeDeploymentJournal,
  completeSingleNodeDeploymentMutation,
  createSingleNodeDeploymentJournal,
  prepareSingleNodeDeploymentMutation,
  prepareSingleNodeDeploymentMutations,
} from '../../src/core/runtime/single-node-deployment-journal.js';
import {
  createSingleNodeStatusActiveJournal,
  createSingleNodeStatusAuthorityFixture,
  createSingleNodeStatusInitialJournal,
} from '../runtime/fixtures/single-node-status-fixture.js';

const DATA_ROOT = '/private/live-acceptance/controller';
const AWS_SCOPE = createAwsProviderScope({
  partition: 'aws',
  accountId: '123456789012',
  region: 'us-east-2',
});
const AWS_IDS = {
  instance: 'i-0123456789abcdef0',
  rootVolume: 'vol-0123456789abcdef0',
  securityGroup: 'sg-0123456789abcdef0',
};
/** @type {Awaited<ReturnType<typeof createSingleNodeStatusAuthorityFixture>>} */
let fixture;
/** @type {Record<string, any>} */
let awsJournal;

beforeAll(async () => {
  fixture = await createSingleNodeStatusAuthorityFixture();
  awsJournal = await createAwsJournal();
});

/** Build real canonical journal authority through the production validators. */
async function createAwsJournal() {
  const desired = createSingleNodeDeploymentDesired({
    intent: createSingleNodeDeploymentIntent({
      deployment: fixture.desired.intent.deployment,
      appId: fixture.desired.intent.appId,
      target: fixture.desired.intent.target,
      mode: fixture.desired.intent.mode,
      machine: fixture.desired.intent.machine,
      access: fixture.desired.intent.access,
      provider: { kind: 'aws', region: AWS_SCOPE.region },
    }),
    revision: fixture.revision,
    artifactRecord: fixture.artifactRecord,
    observation: {
      artifactId: fixture.artifactRecord.artifactId,
      byteDigest: fixture.artifactRecord.byteDigest,
      size: fixture.artifactRecord.size,
    },
  });
  const vpc = 'vpc-0123456789abcdef0';
  const subnet = 'subnet-0123456789abcdef0';
  const gateway = 'igw-0123456789abcdef0';
  const acl = 'acl-0123456789abcdef0';
  const plan = await resolveAwsSingleNodePlan({
    desired,
    providerScope: AWS_SCOPE,
    api: {
      describeImages: async () => ({
        Images: [
          {
            ImageId: 'ami-0123456789abcdef0',
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
                  SnapshotId: 'snap-0123456789abcdef0',
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
          { InstanceType: 't3.small', Location: 'use2-az1' },
        ],
      }),
      describeInstances: async () => ({ Reservations: [] }),
      describeInternetGateways: async () => ({
        InternetGateways: [
          {
            InternetGatewayId: gateway,
            OwnerId: AWS_SCOPE.accountId,
            Attachments: [{ VpcId: vpc, State: 'available' }],
          },
        ],
      }),
      describeNetworkAcls: async () => ({
        NetworkAcls: [
          {
            NetworkAclId: acl,
            VpcId: vpc,
            OwnerId: AWS_SCOPE.accountId,
            IsDefault: true,
            Associations: [
              {
                NetworkAclAssociationId: 'aclassoc-0123456789abcdef0',
                NetworkAclId: acl,
                SubnetId: subnet,
              },
            ],
            Entries: [false, true].flatMap((Egress) => [
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
            ]),
          },
        ],
      }),
      describeRouteTables: async () => ({
        RouteTables: [
          {
            RouteTableId: 'rtb-0123456789abcdef0',
            VpcId: vpc,
            OwnerId: AWS_SCOPE.accountId,
            Associations: [{ Main: true }],
            Routes: [
              {
                DestinationCidrBlock: '0.0.0.0/0',
                GatewayId: gateway,
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
            SubnetId: subnet,
            VpcId: vpc,
            OwnerId: AWS_SCOPE.accountId,
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
            VpcId: vpc,
            OwnerId: AWS_SCOPE.accountId,
            IsDefault: true,
            State: 'available',
          },
        ],
      }),
    },
  });
  const intent = createAwsSingleNodeProvisioningIntent({
    plan,
    incarnationId: fixture.incarnationId,
    cloudInitDigest: {
      algorithm: 'sha256',
      value: sha256Base64Url('cloud-init'),
    },
  });
  let journal = advanceSingleNodeDeploymentJournal(
    createSingleNodeDeploymentJournal({
      desired,
      providerIntent: { provider: 'aws', intent },
    }),
    'provisioning',
  );
  journal = prepareSingleNodeDeploymentMutations(
    journal,
    ['securityGroup', 'instance', 'rootVolume'].map((role) =>
      createAwsProvisioningMutationAttempt(intent, role),
    ),
  );
  for (const role of ['securityGroup', 'instance', 'rootVolume']) {
    journal = completeSingleNodeDeploymentMutation(
      journal,
      createAwsProvisionedResourceRecord(
        intent,
        role,
        AWS_IDS[/** @type {keyof typeof AWS_IDS} */ (role)],
      ),
    );
  }
  return journal;
}

/** @param {Record<string, Function>} [overrides] */
function hetznerHarness(overrides = {}) {
  const absent = async () => {
    throw new HetznerApiError('HETZNER_API_ERROR', 'resource absent', {
      status: 404,
    });
  };
  /** @type {Record<string, any>} */
  const api = {
    listServers: jest.fn(async () => []),
    listPrimaryIps: jest.fn(async () => []),
    listFirewalls: jest.fn(async () => []),
    getServer: jest.fn(absent),
    getPrimaryIp: jest.fn(absent),
    getFirewall: jest.fn(absent),
    ...overrides,
  };
  /** @type {jest.Mock<(input: any) => Promise<any>>} */
  const requireBinding = jest.fn(async () => ({
    schemaVersion: 1,
    kind: 'hetznerCredentialBindingEvidence',
    deploymentInstanceId: fixture.desired.deploymentInstanceId,
    bindingId: `whcb1_${sha256Base64Url('binding')}`,
  }));
  const createClient = jest.fn(() => api);
  const audit = createLiveDeploymentCleanupAuditor({
    readHetznerToken: () => 'private-token',
    requireHetznerBinding: requireBinding,
    createHetznerReadClient: createClient,
  });
  return { api, audit, requireBinding, createClient };
}

/** @param {Record<string, Function>} [overrides] */
function awsHarness(overrides = {}) {
  /** @type {Record<string, any>} */
  const api = {
    describeInstances: jest.fn(async () => ({ Reservations: [] })),
    describeVolumes: jest.fn(async () => ({ Volumes: [] })),
    describeSecurityGroups: jest.fn(async () => ({ SecurityGroups: [] })),
    ...overrides,
  };
  const authority = {
    providerScope: AWS_SCOPE,
    resolveScope: jest.fn(async () => AWS_SCOPE),
    api,
    close: jest.fn(async () => {}),
  };
  const open = jest.fn(async () => authority);
  const audit = createLiveDeploymentCleanupAuditor({
    createAwsReadAuthority: open,
  });
  return { api, authority, open, audit };
}

describe('independent live deployment cleanup audit', () => {
  it('rejects missing or corrupted journal identity before acquiring cloud authority', async () => {
    const { audit, createClient } = hetznerHarness();
    await expect(
      audit({ journal: null, dataRoot: DATA_ROOT }),
    ).rejects.toThrow();
    await expect(
      audit({
        journal: {
          ...createSingleNodeStatusActiveJournal(fixture),
          deploymentInstanceId: 'untrusted-selector',
        },
        dataRoot: DATA_ROOT,
      }),
    ).rejects.toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('requires all exact Hetzner IDs absent and independently inventories each owned resource kind', async () => {
    const { audit, api, requireBinding } = hetznerHarness();
    const journal = createSingleNodeStatusActiveJournal(fixture);
    const result = await audit({ journal, dataRoot: DATA_ROOT });
    expect(result.status).toBe('absent');
    expect(result.resources).toEqual([
      { role: 'server', id: 103, status: 'absent' },
      { role: 'primaryIp', id: 102, status: 'absent' },
      { role: 'firewall', id: 101, status: 'absent' },
    ]);
    expect(api.getServer).toHaveBeenCalledWith(103);
    expect(api.getPrimaryIp).toHaveBeenCalledWith(102);
    expect(api.getFirewall).toHaveBeenCalledWith(101);
    for (const method of ['listServers', 'listPrimaryIps', 'listFirewalls'])
      expect(api[method]).toHaveBeenCalledWith({
        labelSelector: getHetznerDeploymentLabelSelector(
          journal.deploymentInstanceId,
        ),
      });
    expect(requireBinding).toHaveBeenCalledWith({
      dataRoot: DATA_ROOT,
      deploymentInstanceId: journal.deploymentInstanceId,
      token: 'private-token',
    });
    expect(JSON.stringify(result)).not.toContain('private-token');
  });

  it('finds an ID whose ownership labels disappeared even when inventory is empty', async () => {
    const { audit } = hetznerHarness({
      getPrimaryIp: async () => ({ id: 102, token: 'provider-body-secret' }),
    });
    const result = await audit({
      journal: createSingleNodeStatusActiveJournal(fixture),
      dataRoot: DATA_ROOT,
    });
    expect(result.status).toBe('present');
    expect(result.resources).toContainEqual({
      role: 'primaryIp',
      id: 102,
      status: 'present',
    });
    expect(JSON.stringify(result)).not.toContain('provider-body-secret');
  });

  it('finds an ambiguous Hetzner create without a recorded provider ID', async () => {
    let journal = advanceSingleNodeDeploymentJournal(
      createSingleNodeStatusInitialJournal(fixture),
      'provisioning',
    );
    journal = prepareSingleNodeDeploymentMutation(
      journal,
      createHetznerProvisioningMutationAttempt(
        fixture.providerIntent.intent,
        'firewall',
      ),
    );
    const { audit, api } = hetznerHarness({
      listFirewalls: async () => [{ id: 777 }],
    });
    const result = await audit({ journal, dataRoot: DATA_ROOT });
    expect(result.status).toBe('present');
    expect(result.inventory).toContainEqual({
      role: 'firewall',
      status: 'present',
      count: 1,
    });
    expect(api.getFirewall).not.toHaveBeenCalled();
  });

  it.each([
    async () => {
      throw new Error('private-token request failed');
    },
    async () => {
      throw new HetznerApiError('HETZNER_API_ERROR', 'forbidden', {
        status: 403,
      });
    },
    async () => null,
    async () => ({ id: 999 }),
  ])(
    'does not treat denied, failed, malformed, or mismatched ID reads as absence',
    async (getServer) => {
      const { audit } = hetznerHarness({ getServer });
      const result = await audit({
        journal: createSingleNodeStatusActiveJournal(fixture),
        dataRoot: DATA_ROOT,
      });
      expect(result.status).toBe('unknown');
      expect(result.reason).toBe('provider-read-failed');
      expect(JSON.stringify(result)).not.toContain('private-token');
    },
  );

  it('rejects a changed Hetzner credential binding before reading the provider', async () => {
    const { audit, createClient, requireBinding } = hetznerHarness();
    requireBinding.mockRejectedValue(new Error('token changed'));
    const result = await audit({
      journal: createSingleNodeStatusActiveJournal(fixture),
      dataRoot: DATA_ROOT,
    });
    expect(result.status).toBe('unknown');
    expect(result.reason).toBe('credential-binding-failed');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('accepts terminated EC2 tombstones only after root volume and security group absence', async () => {
    const { audit, api, authority } = awsHarness({
      describeInstances: jest.fn(async () => ({
        Reservations: [
          {
            Instances: [
              { InstanceId: AWS_IDS.instance, State: { Name: 'terminated' } },
            ],
          },
        ],
      })),
    });
    const result = await audit({ journal: awsJournal });
    expect(result.status).toBe('absent');
    expect(
      result.resources.map((/** @type {any} */ entry) => entry.status),
    ).toEqual(['absent', 'absent', 'absent']);
    expect(api.describeInstances).toHaveBeenCalledWith({
      Filters: [{ Name: 'instance-id', Values: [AWS_IDS.instance] }],
      MaxResults: 500,
    });
    expect(api.describeVolumes).toHaveBeenCalledWith({
      Filters: [{ Name: 'volume-id', Values: [AWS_IDS.rootVolume] }],
      MaxResults: 500,
    });
    expect(api.describeSecurityGroups).toHaveBeenCalledWith({
      Filters: getAwsSingleNodeDeploymentInventoryFilters(
        awsJournal.deploymentInstanceId,
      ),
      MaxResults: 500,
    });
    expect(authority.close).toHaveBeenCalledTimes(1);
  });

  it.each(['running', 'shutting-down'])(
    'keeps an EC2 %s instance classified present',
    async (state) => {
      const { audit } = awsHarness({
        describeInstances: async () => ({
          Reservations: [
            {
              Instances: [
                { InstanceId: AWS_IDS.instance, State: { Name: state } },
              ],
            },
          ],
        }),
      });
      expect((await audit({ journal: awsJournal })).status).toBe('present');
    },
  );

  it('finds owned AWS residue on later pages even when all durable IDs are absent', async () => {
    const describeVolumes = jest.fn(async (/** @type {any} */ request) =>
      request.Filters[0].Name === 'volume-id'
        ? { Volumes: [] }
        : request.NextToken === 'second'
          ? { Volumes: [{ VolumeId: 'vol-11111111111111111' }] }
          : { Volumes: [], NextToken: 'second' },
    );
    const { audit } = awsHarness({ describeVolumes });
    const result = await audit({ journal: awsJournal });
    expect(result.status).toBe('present');
    expect(result.inventory).toContainEqual({
      role: 'rootVolume',
      count: 1,
      status: 'present',
    });
    expect(result.resources).toContainEqual({
      role: 'rootVolume',
      id: AWS_IDS.rootVolume,
      status: 'absent',
    });
  });

  it.each([
    async () => ({ Volumes: [], NextToken: 'repeated' }),
    async () => ({ Volumes: [{ VolumeId: 'invalid' }] }),
    async () => ({}),
    async () => {
      throw new Error('AWS_SECRET_ACCESS_KEY=secret');
    },
  ])(
    'fails closed on incomplete AWS inventory and releases SDK clients',
    async (describeVolumes) => {
      const { audit, authority } = awsHarness({ describeVolumes });
      const result = await audit({ journal: awsJournal });
      expect(result.status).toBe('unknown');
      expect(JSON.stringify(result)).not.toContain('AWS_SECRET_ACCESS_KEY');
      expect(authority.close).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects wrong-account AWS credentials before any EC2 read', async () => {
    const { audit, authority, api } = awsHarness();
    authority.resolveScope.mockResolvedValue(
      createAwsProviderScope({
        partition: 'aws',
        accountId: '999999999999',
        region: AWS_SCOPE.region,
      }),
    );
    const result = await audit({ journal: awsJournal });
    expect(result.reason).toBe('provider-scope-mismatch');
    expect(result.status).toBe('unknown');
    expect(api.describeInstances).not.toHaveBeenCalled();
    expect(authority.close).toHaveBeenCalledTimes(1);
  });

  it('bounds stalled reads and returns an immutable observation snapshot', async () => {
    /** @type {(value: any) => void} */
    let settle = (value) => {
      throw new Error(`Unexpected settlement: ${value}`);
    };
    const pending = new Promise((resolve) => {
      settle = resolve;
    });
    const { authority } = awsHarness({ describeVolumes: async () => pending });
    const audit = createLiveDeploymentCleanupAuditor({
      createAwsReadAuthority: async () => authority,
      timeoutMs: 10,
    });
    const result = await audit({ journal: awsJournal });
    expect(result.status).toBe('unknown');
    expect(result.reason).toBe('provider-read-timeout');
    expect(authority.close).toHaveBeenCalledTimes(1);
    const before = JSON.stringify(result);
    settle({ Volumes: [] });
    await new Promise((resolve) => setImmediate(resolve));
    expect(JSON.stringify(result)).toBe(before);
  });
});
