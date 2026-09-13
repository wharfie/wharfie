/* eslint-disable jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- Offline canonical AWS reboot ownership fixtures. */

import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import assert from 'node:assert/strict';

import { rebootLiveDeploymentProvider } from '../../scripts/live-deployment-reboot-child.js';
import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import { AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS } from '../../src/core/runtime/providers/aws/ownership.js';
import { createAwsSingleNodeResourceIdentity } from '../../src/core/runtime/providers/aws/resource-identity.js';
import {
  createAwsProvisionedResourceRecord,
  createAwsProvisioningMutationAttempt,
} from '../../src/core/runtime/providers/aws/single-node-journal-evidence.js';
import { resolveAwsSingleNodePlan } from '../../src/core/runtime/providers/aws/single-node-plan.js';
import { createAwsSingleNodeProvisioningIntent } from '../../src/core/runtime/providers/aws/single-node-provisioning-intent.js';
import { createSingleNodeDeploymentDesired } from '../../src/core/runtime/single-node-deployment-desired.js';
import { createSingleNodeDeploymentIntent } from '../../src/core/runtime/single-node-deployment-intent.js';
import {
  advanceSingleNodeDeploymentJournal,
  completeSingleNodeDeploymentMutation,
  createSingleNodeDeploymentJournal,
  getSingleNodeDeploymentCurrentRelease,
  prepareSingleNodeDeploymentMutations,
  recordSingleNodeDeploymentActivation,
  recordSingleNodeDeploymentResource,
  recordSingleNodeDeploymentSshHost,
  settleSingleNodeDeploymentReleaseTransition,
} from '../../src/core/runtime/single-node-deployment-journal.js';
import {
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
  SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
} from '../../src/core/runtime/single-node-remote-activation.js';
import {
  createSingleNodeStatusActiveJournal,
  createSingleNodeStatusAuthorityFixture,
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
  fixture = await createSingleNodeStatusAuthorityFixture({
    deploymentId: 'acceptance-a8234df0-0cc3-455f-8d75-afd7b7482903',
  });
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
  journal = recordSingleNodeDeploymentResource(journal, {
    ...journal.resources.find(
      (/** @type {Record<string, any>} */ entry) => entry.role === 'instance',
    ),
    publicIpv4: fixture.publicIpv4,
  });
  journal = advanceSingleNodeDeploymentJournal(journal, 'provisioned');
  journal = recordSingleNodeDeploymentSshHost(journal, {
    address: fixture.publicIpv4,
    algorithm: 'ssh-ed25519',
    fingerprint: fixture.hostKeyFingerprint,
  });
  journal = advanceSingleNodeDeploymentJournal(journal, 'activating');
  const reference = getSingleNodeDeploymentCurrentRelease(
    createSingleNodeStatusActiveJournal(fixture),
  );
  assert.ok(reference);
  const { activationEvidenceId: originalEvidenceId, ...payload } =
    reference.activation;
  expect(originalEvidenceId).toBeDefined();
  const evidence = {
    ...payload,
    deploymentInstanceId: desired.deploymentInstanceId,
    desiredRevisionId: desired.desiredRevisionId,
    artifact: {
      ...payload.artifact,
      remotePath: payload.artifact.remotePath.replace(
        fixture.desired.deploymentInstanceId,
        desired.deploymentInstanceId,
      ),
    },
  };
  journal = recordSingleNodeDeploymentActivation(journal, {
    ...evidence,
    activationEvidenceId: createCanonicalJsonSha256Id({
      domain: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_DOMAIN,
      prefix: SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
      value: evidence,
    }),
  });
  journal = settleSingleNodeDeploymentReleaseTransition(journal);
  return advanceSingleNodeDeploymentJournal(journal, 'active');
}

/** Isolate each provider observation; every capability records its exact call. */
function harness() {
  const tags = structuredClone(
    createAwsSingleNodeResourceIdentity(
      awsJournal.providerIntent.intent,
      'instance',
    ).tags,
  );
  /** @type {Record<string, any>} */
  const instance = {
    InstanceId: AWS_IDS.instance,
    State: { Name: 'running' },
    PublicIpAddress: fixture.publicIpv4,
    Tags: tags,
  };
  /** @type {Record<string, any>} */
  const response = { Reservations: [{ Instances: [instance] }] };
  const calls = /** @type {string[]} */ ([]);
  const api = {
    scope: jest.fn(async () => {
      calls.push('scope');
      return AWS_SCOPE;
    }),
    describe: jest.fn(async (/** @type {string} */ instanceId) => {
      calls.push('describe');
      expect(instanceId).toBe(AWS_IDS.instance);
      return response;
    }),
    reboot: jest.fn(async (/** @type {string} */ instanceId) => {
      calls.push('reboot');
      expect(instanceId).toBe(AWS_IDS.instance);
    }),
    close: jest.fn(async () => {
      calls.push('close');
    }),
  };
  const awsPorts = jest.fn(async (/** @type {string} */ region) => {
    expect(region).toBe(AWS_SCOPE.region);
    return api;
  });
  return {
    instance,
    response,
    api,
    awsPorts,
    calls,
    run: () =>
      rebootLiveDeploymentProvider(
        { journal: awsJournal, dataRoot: DATA_ROOT },
        { awsPorts },
      ),
  };
}

describe('live AWS reboot exact ownership', () => {
  it('reboots once after matching scope, exact host and all ownership tags', async () => {
    const setup = harness();
    // AWS does not promise tag order, and unrelated user tags convey no authority.
    setup.instance.Tags.reverse();
    setup.instance.Tags.push({ Key: 'acceptance-note', Value: 'unrelated' });
    await expect(setup.run()).resolves.toEqual({
      schemaVersion: 1,
      kind: 'wharfie.live-deployment.reboot',
      provider: 'aws',
      deploymentInstanceId: awsJournal.deploymentInstanceId,
      resourceId: AWS_IDS.instance,
      action: 'reboot-requested',
    });
    expect(setup.calls).toEqual(['scope', 'describe', 'reboot', 'close']);
    expect(setup.awsPorts).toHaveBeenCalledTimes(1);
    expect(setup.api.reboot).toHaveBeenCalledTimes(1);
    expect(setup.api.reboot).toHaveBeenCalledWith(AWS_IDS.instance);
  });

  it.each([
    { accountId: '999999999999', partition: 'aws', region: 'us-east-2' },
    { accountId: '123456789012', partition: 'aws', region: 'us-east-1' },
    { accountId: '123456789012', partition: 'aws-cn', region: 'cn-north-1' },
  ])(
    'rejects a changed account, region or partition before inventory: %j',
    async (scope) => {
      const setup = harness();
      setup.api.scope.mockResolvedValue(createAwsProviderScope(scope));
      await expect(setup.run()).rejects.toThrow();
      expect(setup.api.describe).not.toHaveBeenCalled();
      expect(setup.api.reboot).not.toHaveBeenCalled();
      expect(setup.api.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['InstanceId', 'PublicIpAddress', 'State'])(
    'rejects conflicting host field %s',
    async (field) => {
      const setup = harness();
      setup.instance[field] =
        field === 'State'
          ? { Name: 'stopped' }
          : field === 'InstanceId'
            ? 'i-1123456789abcdef0'
            : '203.0.113.99';
      await expect(setup.run()).rejects.toThrow();
      expect(setup.api.reboot).not.toHaveBeenCalled();
      expect(setup.api.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['Name', ...Object.values(AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS)])(
    'rejects a changed ownership tag %s, including the nonce',
    async (key) => {
      const setup = harness();
      const selected = setup.instance.Tags.find(
        (/** @type {{Key: string}} */ tag) => tag.Key === key,
      );
      expect(selected).toBeDefined();
      selected.Value = 'conflicting-authority';
      await expect(setup.run()).rejects.toThrow();
      expect(setup.api.reboot).not.toHaveBeenCalled();
      expect(setup.api.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'missing-nonce',
    'duplicate-nonce',
    'unknown-ownership-tag',
    'oversized-tags',
  ])(
    'rejects ambiguous or incomplete ownership evidence: %s',
    async (fault) => {
      const setup = harness();
      const nonce = setup.instance.Tags.find(
        (/** @type {{Key: string}} */ tag) =>
          tag.Key === AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS.nonce,
      );
      if (fault === 'missing-nonce')
        setup.instance.Tags = setup.instance.Tags.filter(
          (/** @type {{Key: string}} */ tag) => tag.Key !== nonce.Key,
        );
      else if (fault === 'duplicate-nonce')
        setup.instance.Tags.push({ ...nonce });
      else if (fault === 'unknown-ownership-tag')
        setup.instance.Tags.push({
          Key: 'wharfie:unknown',
          Value: 'unexpected',
        });
      else
        setup.instance.Tags.push(
          ...Array.from({ length: 65 }, (_, index) => ({
            Key: `unrelated-${index}`,
            Value: 'bounded',
          })),
        );
      await expect(setup.run()).rejects.toThrow();
      expect(setup.api.reboot).not.toHaveBeenCalled();
      expect(setup.api.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'empty',
    'multiple-reservations',
    'multiple-instances',
    'pagination',
  ])('rejects non-exact inventory without rebooting: %s', async (fault) => {
    const setup = harness();
    if (fault === 'empty') setup.response.Reservations = [];
    else if (fault === 'multiple-reservations')
      setup.response.Reservations.push({ Instances: [setup.instance] });
    else if (fault === 'multiple-instances')
      setup.response.Reservations[0].Instances.push({ ...setup.instance });
    else setup.response.NextToken = 'unread-page';
    await expect(setup.run()).rejects.toThrow();
    expect(setup.api.reboot).not.toHaveBeenCalled();
    expect(setup.api.close).toHaveBeenCalledTimes(1);
  });

  it('does not retry a reboot whose successful effect may have lost its response', async () => {
    const setup = harness();
    const lost = new Error('Provider reboot response lost.');
    setup.api.reboot.mockRejectedValue(lost);
    await expect(setup.run()).rejects.toBe(lost);
    expect(setup.api.scope).toHaveBeenCalledTimes(1);
    expect(setup.api.describe).toHaveBeenCalledTimes(1);
    expect(setup.api.reboot).toHaveBeenCalledTimes(1);
    expect(setup.api.close).toHaveBeenCalledTimes(1);
  });

  it.each(['scope', 'describe'])(
    'does not reboot or retry after failed %s observation',
    async (phase) => {
      const setup = harness();
      const failed = new Error('Provider read failed.');
      setup.api[/** @type {'scope'|'describe'} */ (phase)].mockRejectedValue(
        failed,
      );
      await expect(setup.run()).rejects.toBe(failed);
      expect(
        setup.api[/** @type {'scope'|'describe'} */ (phase)],
      ).toHaveBeenCalledTimes(1);
      expect(setup.api.reboot).not.toHaveBeenCalled();
      expect(setup.api.close).toHaveBeenCalledTimes(1);
    },
  );
});
