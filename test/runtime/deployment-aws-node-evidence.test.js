import { describe, expect, it } from '@jest/globals';

import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  AwsSingleNodeNodeEvidenceUnknownError,
  createAwsSingleNodeNodeReadableState,
  decodeAwsSingleNodeNodeExactInstanceResponse,
  decodeAwsSingleNodeNodeExactRootVolumeResponse,
  decodeAwsSingleNodeNodeInstancePage,
  decodeAwsSingleNodeNodeInstanceState,
  decodeAwsSingleNodeNodeRootVolumePage,
  getAwsSingleNodeNodeDesiredReadableState,
  getAwsSingleNodeNodeObservedStateDigest,
  getAwsSingleNodeNodeStateDigest,
} from '../../src/core/runtime/deployment-aws-node-evidence.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
  validateDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import {
  createAwsProviderScope,
  validateProviderScope,
} from '../../src/core/runtime/deployment-provider-scope.js';
import { createDeploymentIncarnationId } from '../../src/core/runtime/deployment-resource-binding.js';

/** @typedef {Record<string, any>} AnyRecord */

const ACCOUNT_ID = '123456789012';
const INSTANCE_ID = 'i-00000000000000001';
const ROOT_VOLUME_ID = 'vol-00000000000000001';
const NETWORK_INTERFACE_ID = 'eni-00000000000000001';
const VPC_ID = 'vpc-00000000000000001';
const SUBNET_ID = 'subnet-00000000000000001';
const SECURITY_GROUP_ID = 'sg-00000000000000001';
const INSTANCE_PROFILE_ID = 'AIPA1234567890EXAMPLE';
const INSTANCE_PROFILE_ARN =
  'arn:aws:iam::123456789012:instance-profile/wharfie-test';
const OBSERVED_AT = '2026-07-24T12:34:56.000Z';

/** @param {any} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

function makeFixture() {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'node-evidence-test',
      target: {
        nodeVersion: '24.13.1',
        platform: 'linux',
        architecture: 'x64',
        libc: 'glibc',
      },
      mode: { kind: 'single-node-systemd-user', version: 1 },
      provider: createAwsSingleNodeProvider('us-east-1'),
    }),
  );
  const providerScope = validateProviderScope(
    createAwsProviderScope({
      partition: 'aws',
      accountId: ACCOUNT_ID,
      region: 'us-east-1',
    }),
  );
  const providerSpec = createAwsSingleNodeProviderSpec({
    profile,
    providerScope,
    machineImage: {
      sourceParameter: {
        name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64,
        version: 42,
      },
      imageId: 'ami-0123456789abcdef0',
      ownerAccountId: '137112412989',
      architecture: 'x86_64',
      imageType: 'machine',
      rootDeviceType: 'ebs',
      virtualizationType: 'hvm',
      enaSupport: true,
      rootDeviceName: '/dev/xvda',
      rootBlockDevice: {
        snapshotId: 'snap-0123456789abcdef0',
        volumeType: 'gp3',
        volumeSizeGiB: 8,
        encrypted: false,
        deleteOnTermination: true,
      },
    },
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
  });
  const nameAuthority = Object.freeze({
    providerScopeId: providerScope.providerScopeId,
    deploymentInstanceId: createCanonicalJsonSha256Id({
      domain: 'wharfie:test:node-evidence-deployment-instance:v1',
      prefix: 'wdi1',
      value: { fixture: 1 },
    }),
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 7)),
  });
  return Object.freeze({
    providerScope,
    providerSpec,
    nameAuthority,
  });
}

const FIXTURE = makeFixture();

function makeInstanceOptions() {
  return {
    providerSpec: FIXTURE.providerSpec,
    providerScopeAccountId: ACCOUNT_ID,
    vpcId: VPC_ID,
    subnetId: SUBNET_ID,
    securityGroupId: SECURITY_GROUP_ID,
    instanceProfileId: INSTANCE_PROFILE_ID,
    instanceProfileArn: INSTANCE_PROFILE_ARN,
  };
}

/** @param {unknown} capacityReservationTarget */
function makeReadableInstance(capacityReservationTarget) {
  const node = FIXTURE.providerSpec.node;
  return {
    ImageId: FIXTURE.providerSpec.machineImage.imageId,
    Architecture: FIXTURE.providerSpec.machineImage.architecture,
    InstanceType: node.instanceType,
    State: { Code: 80, Name: 'stopped' },
    AmiLaunchIndex: 0,
    EbsOptimized: node.ebsOptimized,
    EnaSupport: FIXTURE.providerSpec.machineImage.enaSupport,
    VirtualizationType: FIXTURE.providerSpec.machineImage.virtualizationType,
    RootDeviceName: node.rootVolume.deviceName,
    RootDeviceType: FIXTURE.providerSpec.machineImage.rootDeviceType,
    SourceDestCheck: node.primaryNetworkInterface.sourceDestCheck,
    VpcId: VPC_ID,
    SubnetId: SUBNET_ID,
    SecurityGroups: [{ GroupId: SECURITY_GROUP_ID }],
    IamInstanceProfile: {
      Id: INSTANCE_PROFILE_ID,
      Arn: INSTANCE_PROFILE_ARN,
    },
    NetworkInterfaces: [
      {
        NetworkInterfaceId: NETWORK_INTERFACE_ID,
        OwnerId: ACCOUNT_ID,
        VpcId: VPC_ID,
        SubnetId: SUBNET_ID,
        Status: 'in-use',
        Groups: [{ GroupId: SECURITY_GROUP_ID }],
        Attachment: {
          Status: 'attached',
          DeviceIndex: node.primaryNetworkInterface.deviceIndex,
          NetworkCardIndex: node.primaryNetworkInterface.networkCardIndex,
          DeleteOnTermination: node.primaryNetworkInterface.deleteOnTermination,
        },
        PrivateIpAddress: '10.42.0.10',
        PrivateIpAddresses: [{ Primary: true, PrivateIpAddress: '10.42.0.10' }],
        InterfaceType: node.primaryNetworkInterface.interfaceType,
        Description: node.primaryNetworkInterface.description,
        SourceDestCheck: node.primaryNetworkInterface.sourceDestCheck,
        Ipv4Prefixes: [],
        Ipv6Addresses: [],
        Ipv6Prefixes: [],
      },
    ],
    PrivateIpAddress: '10.42.0.10',
    BlockDeviceMappings: [
      {
        DeviceName: node.rootVolume.deviceName,
        Ebs: {
          DeleteOnTermination: node.rootVolume.deleteOnTermination,
          Status: 'attached',
          VolumeId: ROOT_VOLUME_ID,
        },
      },
    ],
    Placement: {
      AvailabilityZoneId: FIXTURE.providerSpec.placement.availabilityZoneId,
      Tenancy: node.tenancy,
    },
    Monitoring: { State: node.monitoring ? 'enabled' : 'disabled' },
    CapacityReservationSpecification: {
      CapacityReservationPreference: node.capacityReservationPreference,
      ...(capacityReservationTarget === undefined
        ? {}
        : { CapacityReservationTarget: capacityReservationTarget }),
    },
    HibernationOptions: { Configured: node.hibernation },
    EnclaveOptions: { Enabled: node.enclave },
    MetadataOptions: {
      State: 'applied',
      HttpEndpoint: node.metadataOptions.httpEndpoint,
      HttpTokens: node.metadataOptions.httpTokens,
      HttpPutResponseHopLimit: node.metadataOptions.httpPutResponseHopLimit,
      HttpProtocolIpv6: node.metadataOptions.httpProtocolIpv6,
      InstanceMetadataTags: node.metadataOptions.instanceMetadataTags,
    },
    PrivateDnsNameOptions: {
      HostnameType: node.privateDnsNameOptions.hostnameType,
      EnableResourceNameDnsARecord:
        node.privateDnsNameOptions.enableResourceNameDnsARecord,
      EnableResourceNameDnsAAAARecord:
        node.privateDnsNameOptions.enableResourceNameDnsAaaaRecord,
    },
    MaintenanceOptions: { AutoRecovery: node.maintenanceAutoRecovery },
  };
}

/** @param {unknown} target */
function decodeCapacityTarget(target) {
  return decodeAwsSingleNodeNodeInstanceState(
    makeReadableInstance(target),
    makeInstanceOptions(),
  ).readableState;
}

/** @param {Readonly<Record<string, any>>} instance */
function completeObservedState(instance) {
  const desired = getAwsSingleNodeNodeDesiredReadableState(
    FIXTURE.providerSpec,
    FIXTURE.nameAuthority,
  );
  return createAwsSingleNodeNodeReadableState(
    instance,
    desired.attributes,
    desired.cpuCredits,
    desired.rootVolume,
  );
}

describe('AWS single-node immutable provider evidence', () => {
  it('deep-clones and freezes instance and root page/exact envelopes', () => {
    const instance = {
      InstanceId: INSTANCE_ID,
      LaunchTime: new Date(OBSERVED_AT),
      Nested: { records: [{ value: 'before' }] },
    };
    const instanceResponse = {
      Reservations: [{ OwnerId: ACCOUNT_ID, Instances: [instance] }],
      NextToken: 'instance-page-2',
    };
    const instancePage = decodeAwsSingleNodeNodeInstancePage(
      instanceResponse,
      FIXTURE.providerScope,
      false,
    );

    expect(instancePage).toEqual({
      records: [
        {
          InstanceId: INSTANCE_ID,
          LaunchTime: OBSERVED_AT,
          Nested: { records: [{ value: 'before' }] },
          __wharfieReservationOwnerId: ACCOUNT_ID,
        },
      ],
      nextToken: 'instance-page-2',
    });
    expect(instancePage.records[0]).not.toBe(instance);
    expect(instancePage.records[0].Nested).not.toBe(instance.Nested);
    expect(instancePage.records[0].Nested.records).not.toBe(
      instance.Nested.records,
    );
    expectDeepFrozen(instancePage);

    instance.Nested.records[0].value = 'after';
    instanceResponse.Reservations.push({
      OwnerId: ACCOUNT_ID,
      Instances: [],
    });
    expect(instancePage.records[0].Nested.records[0].value).toBe('before');
    expect(instancePage.records).toHaveLength(1);

    const exactInstanceSource = {
      InstanceId: INSTANCE_ID,
      LaunchTime: new Date(OBSERVED_AT),
      Nested: { value: 'exact-instance' },
    };
    const exactInstance = decodeAwsSingleNodeNodeExactInstanceResponse(
      {
        Reservations: [
          { OwnerId: ACCOUNT_ID, Instances: [exactInstanceSource] },
        ],
      },
      INSTANCE_ID,
      FIXTURE.providerScope,
    );
    expect(exactInstance).toEqual({
      InstanceId: INSTANCE_ID,
      LaunchTime: OBSERVED_AT,
      Nested: { value: 'exact-instance' },
      __wharfieReservationOwnerId: ACCOUNT_ID,
    });
    expect(exactInstance.Nested).not.toBe(exactInstanceSource.Nested);
    expectDeepFrozen(exactInstance);

    const root = {
      VolumeId: ROOT_VOLUME_ID,
      CreateTime: new Date(OBSERVED_AT),
      Attachments: [{ Device: '/dev/xvda' }],
    };
    const rootPage = decodeAwsSingleNodeNodeRootVolumePage(
      { Volumes: [root], NextToken: 'root-page-2' },
      false,
    );
    expect(rootPage).toEqual({
      records: [
        {
          VolumeId: ROOT_VOLUME_ID,
          CreateTime: OBSERVED_AT,
          Attachments: [{ Device: '/dev/xvda' }],
        },
      ],
      nextToken: 'root-page-2',
    });
    expect(rootPage.records[0].Attachments).not.toBe(root.Attachments);
    expectDeepFrozen(rootPage);

    const exactRootSource = {
      VolumeId: ROOT_VOLUME_ID,
      CreateTime: new Date(OBSERVED_AT),
      Nested: { value: 'exact-root' },
    };
    const exactRoot = decodeAwsSingleNodeNodeExactRootVolumeResponse(
      { Volumes: [exactRootSource] },
      ROOT_VOLUME_ID,
    );
    expect(exactRoot).toEqual({
      VolumeId: ROOT_VOLUME_ID,
      CreateTime: OBSERVED_AT,
      Nested: { value: 'exact-root' },
    });
    expect(exactRoot.Nested).not.toBe(exactRootSource.Nested);
    expectDeepFrozen(exactRoot);
  });

  it('clones caller readable-state inputs before deeply freezing the result', () => {
    const instance = {
      nested: {
        observedAt: new Date(OBSERVED_AT),
        records: [{ value: 'instance-before' }],
      },
    };
    const attributes = {
      userData: 'bootstrap',
      disableApiTermination: false,
      disableApiStop: false,
      instanceInitiatedShutdownBehavior: 'stop',
    };
    const rootVolume = {
      nested: { records: [{ value: 'root-before' }] },
    };

    const readable = createAwsSingleNodeNodeReadableState(
      instance,
      attributes,
      'standard',
      rootVolume,
    );

    expect(readable.instance).not.toBe(instance);
    expect(readable.instance.nested).not.toBe(instance.nested);
    expect(readable.attributes).not.toBe(attributes);
    expect(readable.rootVolume).not.toBe(rootVolume);
    expect(readable.instance.nested.observedAt).toBe(OBSERVED_AT);
    expectDeepFrozen(readable);
    expect(Object.isFrozen(instance)).toBe(false);
    expect(Object.isFrozen(attributes)).toBe(false);
    expect(Object.isFrozen(rootVolume)).toBe(false);

    instance.nested.records[0].value = 'instance-after';
    attributes.userData = 'changed';
    rootVolume.nested.records[0].value = 'root-after';
    expect(readable.instance.nested.records[0].value).toBe('instance-before');
    expect(readable.attributes.userData).toBe('bootstrap');
    expect(readable.rootVolume.nested.records[0].value).toBe('root-before');
  });

  it('rejects cyclic and aliased provider payloads as typed unknown evidence', () => {
    const cyclicInstance = /** @type {AnyRecord} */ ({
      InstanceId: INSTANCE_ID,
    });
    cyclicInstance.self = cyclicInstance;
    expect(() =>
      decodeAwsSingleNodeNodeExactInstanceResponse(
        {
          Reservations: [{ OwnerId: ACCOUNT_ID, Instances: [cyclicInstance] }],
        },
        INSTANCE_ID,
        FIXTURE.providerScope,
      ),
    ).toThrow(AwsSingleNodeNodeEvidenceUnknownError);

    const sharedInstanceValue = { value: 'shared' };
    expect(() =>
      decodeAwsSingleNodeNodeInstancePage(
        {
          Reservations: [
            {
              OwnerId: ACCOUNT_ID,
              Instances: [
                {
                  InstanceId: INSTANCE_ID,
                  first: sharedInstanceValue,
                  second: sharedInstanceValue,
                },
              ],
            },
          ],
        },
        FIXTURE.providerScope,
        false,
      ),
    ).toThrow(AwsSingleNodeNodeEvidenceUnknownError);

    const cyclicRoot = /** @type {AnyRecord} */ ({
      VolumeId: ROOT_VOLUME_ID,
    });
    cyclicRoot.self = cyclicRoot;
    expect(() =>
      decodeAwsSingleNodeNodeExactRootVolumeResponse(
        { Volumes: [cyclicRoot] },
        ROOT_VOLUME_ID,
      ),
    ).toThrow(AwsSingleNodeNodeEvidenceUnknownError);

    const sharedRootValue = { value: 'shared' };
    expect(() =>
      decodeAwsSingleNodeNodeRootVolumePage(
        {
          Volumes: [
            {
              VolumeId: ROOT_VOLUME_ID,
              first: sharedRootValue,
              second: sharedRootValue,
            },
          ],
        },
        false,
      ),
    ).toThrow(AwsSingleNodeNodeEvidenceUnknownError);
  });
});

describe('AWS single-node CapacityReservationTarget evidence', () => {
  it('accepts one finite ID or resource-group ARN as stable drift', () => {
    const targets = [
      { CapacityReservationId: 'cr-0123456789abcdef0' },
      {
        CapacityReservationResourceGroupArn:
          'arn:aws:resource-groups:us-east-1:123456789012:group/example-capacity-pool',
      },
    ];

    for (const target of targets) {
      const first = decodeCapacityTarget(target);
      const second = decodeCapacityTarget(
        Object.fromEntries(Object.entries(target)),
      );

      expect(first.capacityReservation.target).toEqual(target);
      expect(first.capacityReservation.target).not.toBe(target);
      expectDeepFrozen(first.capacityReservation.target);

      const firstDigest = getAwsSingleNodeNodeObservedStateDigest(
        FIXTURE.providerSpec,
        FIXTURE.nameAuthority,
        completeObservedState(first),
      );
      const secondDigest = getAwsSingleNodeNodeObservedStateDigest(
        FIXTURE.providerSpec,
        FIXTURE.nameAuthority,
        completeObservedState(second),
      );
      expect(firstDigest).toEqual(secondDigest);
      expect(firstDigest).not.toEqual(
        getAwsSingleNodeNodeStateDigest(
          FIXTURE.providerSpec,
          FIXTURE.nameAuthority,
        ),
      );
    }
  });

  it('rejects empty, ambiguous, unknown, nested, and cyclic targets', () => {
    const cyclicTarget = {};
    cyclicTarget.CapacityReservationId = cyclicTarget;
    const malformedTargets = [
      {},
      { CapacityReservationId: '' },
      { CapacityReservationId: 'not-a-capacity-reservation' },
      {
        CapacityReservationResourceGroupArn:
          'arn:aws:resource-groups:us-east-1:123456789012:group/',
      },
      {
        CapacityReservationId: 'cr-0123456789abcdef0',
        CapacityReservationResourceGroupArn:
          'arn:aws:resource-groups:us-east-1:123456789012:group/example',
      },
      { Unknown: 'cr-0123456789abcdef0' },
      {
        CapacityReservationId: {
          value: 'cr-0123456789abcdef0',
        },
      },
      {
        CapacityReservationId: 'cr-0123456789abcdef0',
        Nested: { value: true },
      },
      cyclicTarget,
    ];

    for (const target of malformedTargets) {
      expect(() => decodeCapacityTarget(target)).toThrow(
        AwsSingleNodeNodeEvidenceUnknownError,
      );
    }
  });
});
