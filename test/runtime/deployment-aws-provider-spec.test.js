import { describe, expect, it } from '@jest/globals';

import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  AWS_SINGLE_NODE_PROVIDER_CONTRACT_VERSION,
  AWS_SINGLE_NODE_PROVIDER_SPEC_ID_DOMAIN,
  AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
  AWS_SINGLE_NODE_PROVIDER_SPEC_KIND,
  AWS_SINGLE_NODE_PROVIDER_SPEC_SCHEMA_VERSION,
  createAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import { AWS_SINGLE_NODE_RESOURCE_GRAPH } from '../../src/core/runtime/deployment-resource-graph.js';
import {
  AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION,
  AWS_SINGLE_NODE_NODE_BOOTSTRAP_DIGEST,
} from '../../src/core/runtime/deployment-aws-node-bootstrap-contract.js';
import { AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST } from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';

/** @param {string} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {'x64'|'arm64'} [architecture] @param {string} [region] */
function makeProfile(architecture = 'x64', region = 'us-east-1') {
  return createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'provider-spec-demo',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture,
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider(region),
  });
}

/** @param {string} [accountId] @param {string} [region] */
function makeScope(accountId = '123456789012', region = 'us-east-1') {
  return createAwsProviderScope({
    partition: 'aws',
    accountId,
    region,
  });
}

/** @param {'x86_64'|'arm64'} [architecture] */
function makeMachineImage(architecture = 'x86_64') {
  return {
    sourceParameter: {
      name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS[architecture],
      version: 87,
    },
    imageId:
      architecture === 'x86_64'
        ? 'ami-0123456789abcdef0'
        : 'ami-0fedcba9876543210',
    ownerAccountId: '137112412989',
    architecture,
    imageType: 'machine',
    rootDeviceType: 'ebs',
    virtualizationType: 'hvm',
    enaSupport: true,
    rootDeviceName: '/dev/xvda',
    rootBlockDevice: {
      snapshotId:
        architecture === 'x86_64'
          ? 'snap-0123456789abcdef0'
          : 'snap-0fedcba9876543210',
      volumeType: 'gp3',
      volumeSizeGiB: 8,
      encrypted: false,
      deleteOnTermination: true,
    },
  };
}

/** @param {'x64'|'arm64'} [architecture] */
function makeFixture(architecture = 'x64') {
  const profile = makeProfile(architecture);
  const providerScope = makeScope();
  return {
    profile,
    providerScope,
    input: {
      profile,
      providerScope,
      machineImage: makeMachineImage(
        architecture === 'x64' ? 'x86_64' : 'arm64',
      ),
      placement: { availabilityZoneId: 'use1-az2' },
      storage: {
        ebsKmsKeyArn:
          'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
      },
    },
  };
}

describe('AWS single-node provider specifications', () => {
  it('pins every fixed x64 provider input in one content-addressed document', () => {
    const fixture = makeFixture();
    const spec = createAwsSingleNodeProviderSpec(fixture.input);
    const { providerSpecId: _providerSpecId, ...payload } = spec;

    expect(spec).toEqual({
      schemaVersion: 6,
      kind: 'awsSingleNodeProviderSpec',
      providerSpecId: expect.stringMatching(/^wap6_[A-Za-z0-9_-]{43}$/),
      providerContractVersion: 3,
      providerScopeId: fixture.providerScope.providerScopeId,
      profileRevisionId: fixture.profile.profileRevisionId,
      targetId: 'node-v24.13.1-linux-x64-glibc',
      resourceGraphId: AWS_SINGLE_NODE_RESOURCE_GRAPH.resourceGraphId,
      machineImage: makeMachineImage('x86_64'),
      placement: { availabilityZoneId: 'use1-az2' },
      storage: {
        ebsKmsKeyArn:
          'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
      },
      node: {
        instanceType: 't3.small',
        tenancy: 'default',
        purchaseOption: 'on-demand',
        ebsOptimized: true,
        monitoring: false,
        cpuCredits: 'standard',
        capacityReservationPreference: 'none',
        instanceInitiatedShutdownBehavior: 'stop',
        terminationProtection: false,
        stopProtection: false,
        hibernation: false,
        enclave: false,
        maintenanceAutoRecovery: 'default',
        metadataOptions: {
          httpEndpoint: 'enabled',
          httpTokens: 'required',
          httpPutResponseHopLimit: 1,
          httpProtocolIpv6: 'disabled',
          instanceMetadataTags: 'disabled',
        },
        privateDnsNameOptions: {
          hostnameType: 'ip-name',
          enableResourceNameDnsARecord: false,
          enableResourceNameDnsAaaaRecord: false,
        },
        primaryNetworkInterface: {
          deviceIndex: 0,
          networkCardIndex: 0,
          interfaceType: 'interface',
          description: 'Wharfie single-node primary network interface.',
          associatePublicIpv4: true,
          deleteOnTermination: true,
          sourceDestCheck: true,
          secondaryPrivateIpv4AddressCount: 0,
          ipv6AddressCount: 0,
        },
        rootVolume: {
          contractVersion: 1,
          storage: 'ebs-volume',
          deviceName: '/dev/xvda',
          snapshotId: 'snap-0123456789abcdef0',
          volumeType: 'gp3',
          sizeGiB: 8,
          iops: 3000,
          throughputMiBps: 125,
          encrypted: true,
          multiAttach: false,
          deleteOnTermination: true,
          onDestroy: 'purge',
        },
        bootstrap: {
          contractVersion: AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION,
          digest: AWS_SINGLE_NODE_NODE_BOOTSTRAP_DIGEST,
        },
      },
      capabilities: {
        applicationState: {
          contractVersion: 1,
          storage: 'ebs-volume',
          volumeType: 'gp3',
          sizeGiB: 8,
          iops: 3000,
          throughputMiBps: 125,
          multiAttach: false,
          deviceName: '/dev/sdf',
          deleteOnTermination: false,
          encrypted: true,
          onDestroy: 'retain',
        },
        controlState: {
          contractVersion: 1,
          storage: 'ebs-volume',
          volumeType: 'gp3',
          sizeGiB: 8,
          iops: 3000,
          throughputMiBps: 125,
          multiAttach: false,
          deviceName: '/dev/sdg',
          deleteOnTermination: false,
          encrypted: true,
          onDestroy: 'retain',
        },
        artifactStorage: {
          contractVersion: 1,
          storage: 's3-object',
          encryption: 'AES256',
          onDestroy: 'purge',
        },
        runtimeIdentity: {
          contractVersion: 1,
          managementChannel: 'ssm',
          artifactAccess: 'read',
          serviceHealthAccess: 'read-write-current-object',
          applicationInstanceMetadata: 'blocked',
          policyDigest: AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST,
        },
        networking: {
          contractVersion: 1,
          kind: 'public-ipv4-egress-no-ingress',
          vpcCidr: '10.42.0.0/16',
          subnetCidr: '10.42.0.0/24',
          publicIpv4: true,
          egressCidr: '0.0.0.0/0',
          ingressCidrs: [],
        },
        serviceHealth: {
          contractVersion: 1,
          storage: 's3-object',
          intervalSeconds: 15,
          maxAgeSeconds: 60,
          clockSkewSeconds: 5,
          publication: 'conditional-current-object',
          noncurrentVersionExpirationDays: 1,
        },
      },
    });
    expect(spec.providerSpecId).toBe(
      createCanonicalJsonSha256Id({
        domain: 'wharfie:aws-single-node-provider-spec:v6',
        prefix: 'wap6',
        value: payload,
      }),
    );
    expect(AWS_SINGLE_NODE_PROVIDER_SPEC_SCHEMA_VERSION).toBe(6);
    expect(AWS_SINGLE_NODE_PROVIDER_SPEC_KIND).toBe(
      'awsSingleNodeProviderSpec',
    );
    expect(AWS_SINGLE_NODE_PROVIDER_SPEC_ID_DOMAIN).toBe(
      'wharfie:aws-single-node-provider-spec:v6',
    );
    expect(AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX).toBe('wap6');
    expect(AWS_SINGLE_NODE_PROVIDER_CONTRACT_VERSION).toBe(3);
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.machineImage.sourceParameter)).toBe(true);
    expect(Object.isFrozen(spec.machineImage.rootBlockDevice)).toBe(true);
    expect(Object.isFrozen(spec.placement)).toBe(true);
    expect(Object.isFrozen(spec.node.privateDnsNameOptions)).toBe(true);
    expect(Object.isFrozen(spec.node.primaryNetworkInterface)).toBe(true);
    expect(Object.isFrozen(spec.node.rootVolume)).toBe(true);
    expect(Object.isFrozen(spec.capabilities.networking.ingressCidrs)).toBe(
      true,
    );
  });

  it('maps an arm64 SEA target to the exact arm64 image and t4g node', () => {
    const fixture = makeFixture('arm64');
    const spec = createAwsSingleNodeProviderSpec(fixture.input);

    expect(spec).toMatchObject({
      targetId: 'node-v24.13.1-linux-arm64-glibc',
      machineImage: {
        architecture: 'arm64',
        sourceParameter: {
          name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.arm64,
          version: 87,
        },
      },
      node: { instanceType: 't4g.small' },
    });
    expect(
      validateAwsSingleNodeProviderSpecContext(clone(spec), {
        profile: fixture.profile,
        providerScope: fixture.providerScope,
      }),
    ).toEqual(spec);
  });

  it('canonicalizes key order and independently freezes serialized values', () => {
    const fixture = makeFixture();
    const first = createAwsSingleNodeProviderSpec(fixture.input);
    const reordered = {
      machineImage: {
        rootBlockDevice: {
          deleteOnTermination: true,
          encrypted: false,
          volumeSizeGiB: 8,
          volumeType: 'gp3',
          snapshotId: 'snap-0123456789abcdef0',
        },
        rootDeviceName: '/dev/xvda',
        enaSupport: true,
        virtualizationType: 'hvm',
        rootDeviceType: 'ebs',
        imageType: 'machine',
        architecture: 'x86_64',
        ownerAccountId: '137112412989',
        imageId: 'ami-0123456789abcdef0',
        sourceParameter: {
          version: 87,
          name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64,
        },
      },
      placement: { availabilityZoneId: 'use1-az2' },
      storage: {
        ebsKmsKeyArn:
          'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
      },
      providerScope: fixture.providerScope,
      profile: fixture.profile,
    };
    const second = createAwsSingleNodeProviderSpec(reordered);
    const serialized = clone(first);
    const validated = validateAwsSingleNodeProviderSpec(serialized);

    expect(second).toEqual(first);
    expect(validated).toEqual(first);
    expect(validated).not.toBe(serialized);
    serialized.machineImage.imageId = 'ami-0aaaaaaaaaaaaaaaa';
    expect(validated.machineImage.imageId).toBe('ami-0123456789abcdef0');
  });

  it.each([
    [
      'image parameter version',
      (/** @type {any} */ value) => {
        value.machineImage.sourceParameter.version += 1;
      },
    ],
    [
      'exact AMI',
      (/** @type {any} */ value) => {
        value.machineImage.imageId = 'ami-0aaaaaaaaaaaaaaaa';
      },
    ],
    [
      'availability zone',
      (/** @type {any} */ value) => {
        value.placement.availabilityZoneId = 'use1-az4';
      },
    ],
    [
      'EBS encryption key',
      (/** @type {any} */ value) => {
        value.storage.ebsKmsKeyArn =
          'arn:aws:kms:us-east-1:123456789012:key/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      },
    ],
    [
      'image root device',
      (/** @type {any} */ value) => {
        value.machineImage.rootDeviceName = '/dev/sda1';
      },
    ],
    [
      'image root snapshot',
      (/** @type {any} */ value) => {
        value.machineImage.rootBlockDevice.snapshotId =
          'snap-0aaaaaaaaaaaaaaaa';
      },
    ],
    [
      'image root size',
      (/** @type {any} */ value) => {
        value.machineImage.rootBlockDevice.volumeSizeGiB = 16;
      },
    ],
    [
      'provider account scope',
      (/** @type {any} */ value) => {
        value.providerScope = makeScope('210987654321');
        value.storage.ebsKmsKeyArn =
          'arn:aws:kms:us-east-1:210987654321:key/11111111-2222-3333-4444-555555555555';
      },
    ],
  ])('changes identity with the %s', (_name, mutate) => {
    const first = makeFixture();
    const changed = makeFixture();
    mutate(changed.input);

    expect(
      createAwsSingleNodeProviderSpec(changed.input).providerSpecId,
    ).not.toBe(createAwsSingleNodeProviderSpec(first.input).providerSpecId);
  });

  it.each([
    [
      'moving image alias',
      (/** @type {any} */ value) => {
        value.machineImage.sourceParameter.name =
          '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default';
      },
      /sourceParameter\.name is not supported/i,
    ],
    [
      'unversioned image selection',
      (/** @type {any} */ value) => {
        value.machineImage.sourceParameter.version = 0;
      },
      /version must be a positive safe integer/i,
    ],
    [
      'noncanonical image ID',
      (/** @type {any} */ value) => {
        value.machineImage.imageId = 'resolve:ssm:/latest';
      },
      /canonical AWS AMI ID/i,
    ],
    [
      'wrong image owner shape',
      (/** @type {any} */ value) => {
        value.machineImage.ownerAccountId = 'amazon';
      },
      /12-digit AWS account ID/i,
    ],
    [
      'wrong image architecture',
      (/** @type {any} */ value) => {
        value.machineImage = makeMachineImage('arm64');
      },
      /architecture does not match the profile target/i,
    ],
    [
      'noncanonical Availability Zone ID',
      (/** @type {any} */ value) => {
        value.placement.availabilityZoneId = 'us-east-1a';
      },
      /canonical AWS Availability Zone ID/i,
    ],
    [
      'noncanonical EBS KMS key ARN',
      (/** @type {any} */ value) => {
        value.storage.ebsKmsKeyArn = 'alias/aws/ebs';
      },
      /canonical AWS KMS key ARN/i,
    ],
    [
      'non-HVM image',
      (/** @type {any} */ value) => {
        value.machineImage.virtualizationType = 'paravirtual';
      },
      /fixed machine-image contract/i,
    ],
    [
      'noncanonical root device name',
      (/** @type {any} */ value) => {
        value.machineImage.rootDeviceName = 'xvda';
      },
      /canonical AWS EBS root device name/i,
    ],
    [
      'noncanonical root snapshot ID',
      (/** @type {any} */ value) => {
        value.machineImage.rootBlockDevice.snapshotId = 'snapshot-latest';
      },
      /canonical AWS snapshot ID/i,
    ],
    [
      'non-gp3 image root',
      (/** @type {any} */ value) => {
        value.machineImage.rootBlockDevice.volumeType = 'gp2';
      },
      /fixed machine-image root contract/i,
    ],
    [
      'undersized image root',
      (/** @type {any} */ value) => {
        value.machineImage.rootBlockDevice.volumeSizeGiB = 7;
      },
      /fixed machine-image root contract/i,
    ],
    [
      'oversized image root',
      (/** @type {any} */ value) => {
        value.machineImage.rootBlockDevice.volumeSizeGiB = 65;
      },
      /fixed machine-image root contract/i,
    ],
    [
      'encrypted public image root',
      (/** @type {any} */ value) => {
        value.machineImage.rootBlockDevice.encrypted = true;
      },
      /fixed machine-image root contract/i,
    ],
    [
      'retained image root',
      (/** @type {any} */ value) => {
        value.machineImage.rootBlockDevice.deleteOnTermination = false;
      },
      /fixed machine-image root contract/i,
    ],
    [
      'missing image root receipt',
      (/** @type {any} */ value) => {
        delete value.machineImage.rootBlockDevice;
      },
      /rootBlockDevice is required/i,
    ],
    [
      'incomplete image root receipt',
      (/** @type {any} */ value) => {
        delete value.machineImage.rootBlockDevice.snapshotId;
      },
      /rootBlockDevice\.snapshotId is required/i,
    ],
    [
      'unsupported image root receipt field',
      (/** @type {any} */ value) => {
        value.machineImage.rootBlockDevice.iops = 3000;
      },
      /rootBlockDevice\.iops is not supported/i,
    ],
  ])('rejects %s', (_name, mutate, pattern) => {
    const fixture = makeFixture();
    mutate(fixture.input);
    expect(() => createAwsSingleNodeProviderSpec(fixture.input)).toThrow(
      pattern,
    );
  });

  it.each([
    ['tenancy', (/** @type {any} */ node) => (node.tenancy = 'dedicated')],
    [
      'purchase option',
      (/** @type {any} */ node) => (node.purchaseOption = 'spot'),
    ],
    [
      'EBS optimization',
      (/** @type {any} */ node) => (node.ebsOptimized = false),
    ],
    ['monitoring', (/** @type {any} */ node) => (node.monitoring = true)],
    [
      'CPU credits',
      (/** @type {any} */ node) => (node.cpuCredits = 'unlimited'),
    ],
    [
      'capacity reservation',
      (/** @type {any} */ node) =>
        (node.capacityReservationPreference = 'open'),
    ],
    [
      'shutdown behavior',
      (/** @type {any} */ node) =>
        (node.instanceInitiatedShutdownBehavior = 'terminate'),
    ],
    [
      'termination protection',
      (/** @type {any} */ node) => (node.terminationProtection = true),
    ],
    [
      'stop protection',
      (/** @type {any} */ node) => (node.stopProtection = true),
    ],
    ['hibernation', (/** @type {any} */ node) => (node.hibernation = true)],
    ['enclave', (/** @type {any} */ node) => (node.enclave = true)],
    [
      'maintenance auto recovery',
      (/** @type {any} */ node) => (node.maintenanceAutoRecovery = 'disabled'),
    ],
    [
      'metadata endpoint',
      (/** @type {any} */ node) =>
        (node.metadataOptions.httpEndpoint = 'disabled'),
    ],
    [
      'metadata tokens',
      (/** @type {any} */ node) =>
        (node.metadataOptions.httpTokens = 'optional'),
    ],
    [
      'metadata hop limit',
      (/** @type {any} */ node) =>
        (node.metadataOptions.httpPutResponseHopLimit = 2),
    ],
    [
      'metadata IPv6',
      (/** @type {any} */ node) =>
        (node.metadataOptions.httpProtocolIpv6 = 'enabled'),
    ],
    [
      'metadata tags',
      (/** @type {any} */ node) =>
        (node.metadataOptions.instanceMetadataTags = 'enabled'),
    ],
    [
      'private DNS hostname type',
      (/** @type {any} */ node) =>
        (node.privateDnsNameOptions.hostnameType = 'resource-name'),
    ],
    [
      'private DNS A record',
      (/** @type {any} */ node) =>
        (node.privateDnsNameOptions.enableResourceNameDnsARecord = true),
    ],
    [
      'private DNS AAAA record',
      (/** @type {any} */ node) =>
        (node.privateDnsNameOptions.enableResourceNameDnsAaaaRecord = true),
    ],
    [
      'primary ENI description',
      (/** @type {any} */ node) =>
        (node.primaryNetworkInterface.description = 'replacement'),
    ],
    [
      'primary ENI device index',
      (/** @type {any} */ node) =>
        (node.primaryNetworkInterface.deviceIndex = 1),
    ],
    [
      'primary ENI network card index',
      (/** @type {any} */ node) =>
        (node.primaryNetworkInterface.networkCardIndex = 1),
    ],
    [
      'primary ENI interface type',
      (/** @type {any} */ node) =>
        (node.primaryNetworkInterface.interfaceType = 'efa'),
    ],
    [
      'primary ENI public IPv4',
      (/** @type {any} */ node) =>
        (node.primaryNetworkInterface.associatePublicIpv4 = false),
    ],
    [
      'primary ENI delete-on-termination',
      (/** @type {any} */ node) =>
        (node.primaryNetworkInterface.deleteOnTermination = false),
    ],
    [
      'primary ENI source/destination check',
      (/** @type {any} */ node) =>
        (node.primaryNetworkInterface.sourceDestCheck = false),
    ],
    [
      'primary ENI secondary private IPv4 count',
      (/** @type {any} */ node) =>
        (node.primaryNetworkInterface.secondaryPrivateIpv4AddressCount = 1),
    ],
    [
      'primary ENI IPv6 count',
      (/** @type {any} */ node) =>
        (node.primaryNetworkInterface.ipv6AddressCount = 1),
    ],
    [
      'root volume contract version',
      (/** @type {any} */ node) => (node.rootVolume.contractVersion = 2),
    ],
    [
      'root volume storage',
      (/** @type {any} */ node) => (node.rootVolume.storage = 'instance-store'),
    ],
    [
      'root volume device',
      (/** @type {any} */ node) => (node.rootVolume.deviceName = '/dev/sda1'),
    ],
    [
      'root volume snapshot',
      (/** @type {any} */ node) =>
        (node.rootVolume.snapshotId = 'snap-0aaaaaaaaaaaaaaaa'),
    ],
    [
      'root volume size',
      (/** @type {any} */ node) => (node.rootVolume.sizeGiB = 16),
    ],
    [
      'root volume type',
      (/** @type {any} */ node) => (node.rootVolume.volumeType = 'gp2'),
    ],
    [
      'root volume IOPS',
      (/** @type {any} */ node) => (node.rootVolume.iops = 6000),
    ],
    [
      'root volume throughput',
      (/** @type {any} */ node) => (node.rootVolume.throughputMiBps = 250),
    ],
    [
      'root volume encryption',
      (/** @type {any} */ node) => (node.rootVolume.encrypted = false),
    ],
    [
      'root volume multi-attach',
      (/** @type {any} */ node) => (node.rootVolume.multiAttach = true),
    ],
    [
      'root volume delete-on-termination',
      (/** @type {any} */ node) =>
        (node.rootVolume.deleteOnTermination = false),
    ],
    [
      'root volume destroy lifecycle',
      (/** @type {any} */ node) => (node.rootVolume.onDestroy = 'retain'),
    ],
  ])('rejects serialized fixed node %s drift', (_name, mutate) => {
    const spec = clone(createAwsSingleNodeProviderSpec(makeFixture().input));
    mutate(spec.node);
    expect(() => validateAwsSingleNodeProviderSpec(spec)).toThrow(
      /fixed provider contract/i,
    );
  });

  it('rejects serialized drift from the code-owned bootstrap contract', () => {
    const original = createAwsSingleNodeProviderSpec(makeFixture().input);
    const versionDrift = clone(original);
    versionDrift.node.bootstrap.contractVersion += 1;
    expect(() => validateAwsSingleNodeProviderSpec(versionDrift)).toThrow(
      /exact node bootstrap contract/i,
    );

    const digestDrift = /** @type {any} */ (clone(original));
    digestDrift.node.bootstrap.digest = digest('caller-selected bootstrap');
    const { providerSpecId: _oldId, ...digestDriftPayload } = digestDrift;
    digestDrift.providerSpecId = createCanonicalJsonSha256Id({
      domain: AWS_SINGLE_NODE_PROVIDER_SPEC_ID_DOMAIN,
      prefix: AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
      value: digestDriftPayload,
    });
    expect(() => validateAwsSingleNodeProviderSpec(digestDrift)).toThrow(
      /exact node bootstrap template/i,
    );
  });

  it('rejects fixed provider contract drift and identity tampering', () => {
    const fixture = makeFixture();
    const original = createAwsSingleNodeProviderSpec(fixture.input);

    const volumeDrift = clone(original);
    volumeDrift.capabilities.applicationState.sizeGiB = 16;
    expect(() => validateAwsSingleNodeProviderSpec(volumeDrift)).toThrow(
      /fixed provider contract/i,
    );

    const volumePerformanceDrift = clone(original);
    volumePerformanceDrift.capabilities.controlState.iops = 6000;
    expect(() =>
      validateAwsSingleNodeProviderSpec(volumePerformanceDrift),
    ).toThrow(/fixed provider contract/i);

    const volumeAttachmentDrift = clone(original);
    volumeAttachmentDrift.capabilities.applicationState.deviceName = '/dev/sdh';
    expect(() =>
      validateAwsSingleNodeProviderSpec(volumeAttachmentDrift),
    ).toThrow(/fixed provider contract/i);

    const placementDrift = clone(original);
    placementDrift.placement.availabilityZoneId = 'use1-az3';
    expect(() => validateAwsSingleNodeProviderSpec(placementDrift)).toThrow(
      /providerSpecId does not match/i,
    );

    const resourceGraphDrift = /** @type {any} */ (clone(original));
    resourceGraphDrift.resourceGraphId = `wrg2_${'A'.repeat(43)}`;
    expect(() => validateAwsSingleNodeProviderSpec(resourceGraphDrift)).toThrow(
      /exact AWS single-node resource graph/i,
    );

    const publicationDrift = clone(original);
    publicationDrift.capabilities.serviceHealth.publication = 'overwrite';
    expect(() => validateAwsSingleNodeProviderSpec(publicationDrift)).toThrow(
      /fixed provider contract/i,
    );

    const retentionDrift = clone(original);
    retentionDrift.capabilities.serviceHealth.noncurrentVersionExpirationDays = 7;
    expect(() => validateAwsSingleNodeProviderSpec(retentionDrift)).toThrow(
      /fixed provider contract/i,
    );

    const runtimeIdentityDrift = clone(original);
    runtimeIdentityDrift.capabilities.runtimeIdentity.serviceHealthAccess =
      'write';
    expect(() =>
      validateAwsSingleNodeProviderSpec(runtimeIdentityDrift),
    ).toThrow(/fixed provider contract/i);

    const runtimePolicyDrift = clone(original);
    runtimePolicyDrift.capabilities.runtimeIdentity.policyDigest = digest(
      'different runtime policy template',
    );
    expect(() => validateAwsSingleNodeProviderSpec(runtimePolicyDrift)).toThrow(
      /exact runtime IAM policy template/i,
    );

    const instanceDrift = clone(original);
    instanceDrift.node.instanceType = 't4g.small';
    expect(() => validateAwsSingleNodeProviderSpec(instanceDrift)).toThrow(
      /instanceType does not match the machine-image architecture/i,
    );

    const identityDrift = /** @type {any} */ (clone(original));
    identityDrift.providerScopeId = makeScope('210987654321').providerScopeId;
    expect(() => validateAwsSingleNodeProviderSpec(identityDrift)).toThrow(
      /providerSpecId does not match/i,
    );
  });

  it('rejects superseded V5 schema and identity authority', () => {
    const current = createAwsSingleNodeProviderSpec(makeFixture().input);

    const oldSchema = /** @type {any} */ (clone(current));
    oldSchema.schemaVersion = 5;
    expect(() => validateAwsSingleNodeProviderSpec(oldSchema)).toThrow(
      /schemaVersion must be the integer 6/i,
    );

    const oldIdentityNamespace = /** @type {any} */ (clone(current));
    oldIdentityNamespace.providerSpecId =
      oldIdentityNamespace.providerSpecId.replace(/^wap6_/, 'wap5_');
    expect(() =>
      validateAwsSingleNodeProviderSpec(oldIdentityNamespace),
    ).toThrow(/canonical wap6_/i);
  });

  it('cross-checks the exact profile, provider scope, and target', () => {
    const fixture = makeFixture();
    const spec = createAwsSingleNodeProviderSpec(fixture.input);

    expect(() =>
      validateAwsSingleNodeProviderSpecContext(spec, {
        profile: fixture.profile,
        providerScope: makeScope('210987654321'),
      }),
    ).toThrow(
      /does not match the exact profile, provider scope, and build target/i,
    );

    expect(() =>
      validateAwsSingleNodeProviderSpecContext(spec, {
        profile: makeProfile('arm64'),
        providerScope: fixture.providerScope,
      }),
    ).toThrow(
      /does not match the exact profile, provider scope, and build target/i,
    );

    expect(() =>
      validateAwsSingleNodeProviderSpecContext(spec, {
        profile: makeProfile('x64', 'us-west-2'),
        providerScope: fixture.providerScope,
      }),
    ).toThrow(/provider scope does not match.*profile.*region/i);

    for (const ebsKmsKeyArn of [
      'arn:aws:kms:us-west-2:123456789012:key/11111111-2222-3333-4444-555555555555',
      'arn:aws:kms:us-east-1:210987654321:key/11111111-2222-3333-4444-555555555555',
    ]) {
      const wrongKeyScope = /** @type {any} */ (clone(spec));
      wrongKeyScope.storage.ebsKmsKeyArn = ebsKmsKeyArn;
      const { providerSpecId: _oldId, ...wrongKeyPayload } = wrongKeyScope;
      wrongKeyScope.providerSpecId = createCanonicalJsonSha256Id({
        domain: AWS_SINGLE_NODE_PROVIDER_SPEC_ID_DOMAIN,
        prefix: AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
        value: wrongKeyPayload,
      });
      expect(() =>
        validateAwsSingleNodeProviderSpecContext(wrongKeyScope, {
          profile: fixture.profile,
          providerScope: fixture.providerScope,
        }),
      ).toThrow(/KmsKeyArn does not match the exact provider scope/i);
    }
  });

  it('rejects a caller-supplied runtime policy digest', () => {
    const fixture = makeFixture();
    /** @type {any} */ (fixture.input).runtimeIdentityPolicyDigest = digest(
      'caller-selected runtime policy',
    );

    expect(() => createAwsSingleNodeProviderSpec(fixture.input)).toThrow(
      /runtimeIdentityPolicyDigest is not supported/i,
    );
  });

  it('rejects a caller-supplied bootstrap digest', () => {
    const fixture = makeFixture();
    /** @type {any} */ (fixture.input).bootstrapDigest = digest(
      'caller-selected bootstrap',
    );

    expect(() => createAwsSingleNodeProviderSpec(fixture.input)).toThrow(
      /bootstrapDigest is not supported/i,
    );
  });

  it('rejects unsupported or secret-like input without echoing its value', () => {
    const fixture = makeFixture();
    const secret = 'provider-spec-secret-sentinel';
    /** @type {any} */ (fixture.input.machineImage).credentials = secret;
    let thrown;
    try {
      createAwsSingleNodeProviderSpec(fixture.input);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toMatch(/credentials is not supported/i);
    expect(String(thrown)).not.toContain(secret);
  });
});
