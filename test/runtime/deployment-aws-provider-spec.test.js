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
      bootstrapDigest: digest('bootstrap contract'),
      runtimeIdentityPolicyDigest: digest('runtime identity policy'),
    },
  };
}

describe('AWS single-node provider specifications', () => {
  it('pins every fixed x64 provider input in one content-addressed document', () => {
    const fixture = makeFixture();
    const spec = createAwsSingleNodeProviderSpec(fixture.input);
    const { providerSpecId: _providerSpecId, ...payload } = spec;

    expect(spec).toEqual({
      schemaVersion: 3,
      kind: 'awsSingleNodeProviderSpec',
      providerSpecId: expect.stringMatching(/^wap3_[A-Za-z0-9_-]{43}$/),
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
        metadataOptions: {
          httpEndpoint: 'enabled',
          httpTokens: 'required',
          httpPutResponseHopLimit: 1,
          instanceMetadataTags: 'disabled',
        },
        bootstrap: {
          contractVersion: 1,
          digest: digest('bootstrap contract'),
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
          policyDigest: digest('runtime identity policy'),
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
        domain: 'wharfie:aws-single-node-provider-spec:v3',
        prefix: 'wap3',
        value: payload,
      }),
    );
    expect(AWS_SINGLE_NODE_PROVIDER_SPEC_SCHEMA_VERSION).toBe(3);
    expect(AWS_SINGLE_NODE_PROVIDER_SPEC_KIND).toBe(
      'awsSingleNodeProviderSpec',
    );
    expect(AWS_SINGLE_NODE_PROVIDER_SPEC_ID_DOMAIN).toBe(
      'wharfie:aws-single-node-provider-spec:v3',
    );
    expect(AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX).toBe('wap3');
    expect(AWS_SINGLE_NODE_PROVIDER_CONTRACT_VERSION).toBe(3);
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.machineImage.sourceParameter)).toBe(true);
    expect(Object.isFrozen(spec.placement)).toBe(true);
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
      runtimeIdentityPolicyDigest: {
        value: fixture.input.runtimeIdentityPolicyDigest.value,
        algorithm: 'sha256',
      },
      bootstrapDigest: {
        value: fixture.input.bootstrapDigest.value,
        algorithm: 'sha256',
      },
      machineImage: {
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
      'bootstrap contract',
      (/** @type {any} */ value) => {
        value.bootstrapDigest = digest('changed bootstrap');
      },
    ],
    [
      'runtime identity policy',
      (/** @type {any} */ value) => {
        value.runtimeIdentityPolicyDigest = digest('changed policy');
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
  ])('rejects %s', (_name, mutate, pattern) => {
    const fixture = makeFixture();
    mutate(fixture.input);
    expect(() => createAwsSingleNodeProviderSpec(fixture.input)).toThrow(
      pattern,
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
    resourceGraphDrift.resourceGraphId = `wrg1_${'A'.repeat(43)}`;
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
