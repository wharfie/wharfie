import { describe, expect, it, jest } from '@jest/globals';

import {
  AwsSingleNodeProviderSpecConflictError,
  AwsSingleNodeProviderSpecMissingError,
  AwsSingleNodeProviderSpecUnknownError,
  AWS_SINGLE_NODE_PROVIDER_SPEC_RESOLVER_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_PROVIDER_SPEC_RESOLVER_MAX_ATTEMPTS,
  createAwsSingleNodeProviderSpecResolver,
} from '../../src/core/runtime/deployment-aws-provider-spec-resolver.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import {
  createAwsProviderScope,
  getDeploymentInstanceId,
} from '../../src/core/runtime/deployment-provider-scope.js';
import {
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
} from '../../src/core/runtime/deployment-resource-binding.js';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const X64_AMI = 'ami-0123456789abcdef0';
const ARM64_AMI = 'ami-0fedcba9876543210';
const AMAZON_ACCOUNT_ID = '137112412989';
const PRIMARY_AZ_ID = 'use1-az2';
const SECONDARY_AZ_ID = 'use1-az4';
const EBS_KMS_KEY_ARN =
  'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555';

/** @param {string} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {'x64'|'arm64'} [architecture] @param {string} [region] */
function makeProfile(architecture = 'x64', region = 'us-east-1') {
  return createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'resolver-demo',
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

/** @param {ReturnType<typeof makeProfile>} profile */
function makeDeploymentRevision(profile) {
  const payload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId: profile.appId,
    revisionId: semanticId('wrv1', 'wharfie:test:revision:v1', {
      revision: 1,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'provider resolver artifact',
    }),
    profileRevisionId: profile.profileRevisionId,
  };
  return Object.freeze({
    ...payload,
    deploymentRevisionId: semanticId(
      'wdr1',
      'wharfie:deployment-revision:v1',
      payload,
    ),
  });
}

/** @param {'x64'|'arm64'} [architecture] @param {string} [region] @param {string} [partition] */
function makeFixture(
  architecture = 'x64',
  region = 'us-east-1',
  partition = 'aws',
) {
  const profile = makeProfile(architecture, region);
  const deploymentRevision = makeDeploymentRevision(profile);
  const providerScope = createAwsProviderScope({
    partition,
    accountId: '123456789012',
    region,
  });
  const deploymentInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  const incarnationId = createDeploymentIncarnationId(Buffer.alloc(32, 7));
  return Object.freeze({
    profile,
    deploymentRevision,
    providerScope,
    deploymentInstanceId,
    incarnationId,
    head: null,
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Readonly<Record<string, any>>} [providerSpec] */
function makeContext(fixture, providerSpec) {
  return {
    operation: 'apply',
    deploymentRevision: fixture.deploymentRevision,
    providerScope: fixture.providerScope,
    deploymentInstanceId: fixture.deploymentInstanceId,
    incarnationId: fixture.incarnationId,
    profile: fixture.profile,
    head: fixture.head,
    ...(providerSpec === undefined ? {} : { providerSpec }),
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {number} [version] @param {string} [imageId] @returns {Record<string, any>} */
function parameterResponse(fixture, version = 87, imageId) {
  const architecture =
    fixture.profile.target.architecture === 'x64' ? 'x86_64' : 'arm64';
  const name = AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS[architecture];
  return {
    Parameter: {
      Name: name,
      Type: 'String',
      Value:
        imageId ||
        (fixture.profile.target.architecture === 'x64' ? X64_AMI : ARM64_AMI),
      Version: version,
      LastModifiedDate: new Date('2025-12-20T00:00:00.000Z'),
      ARN: `arn:${fixture.providerScope.partition}:ssm:${fixture.providerScope.region}::parameter${name}`,
      DataType: 'text',
    },
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {string} [state] @param {string} [deprecationTime] @returns {Record<string, any>} */
function imageResponse(
  fixture,
  state = 'available',
  deprecationTime = '2027-01-01T00:00:00Z',
) {
  const architecture =
    fixture.profile.target.architecture === 'x64' ? 'x86_64' : 'arm64';
  const name = AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS[architecture];
  return {
    Images: [
      {
        ImageId:
          fixture.profile.target.architecture === 'x64' ? X64_AMI : ARM64_AMI,
        OwnerId: AMAZON_ACCOUNT_ID,
        ImageOwnerAlias: 'amazon',
        Public: true,
        Architecture: architecture,
        ImageType: 'machine',
        RootDeviceType: 'ebs',
        VirtualizationType: 'hvm',
        EnaSupport: true,
        State: state,
        PlatformDetails: 'Linux/UNIX',
        PublicSsmParameterName: name.slice(1),
        ImageAllowed: true,
        DeprecationTime: deprecationTime,
      },
    ],
  };
}

/** @param {string} availabilityZoneId @param {string} region @param {string} [zoneName] @returns {Record<string, any>} */
function availabilityZone(availabilityZoneId, region, zoneName = `${region}a`) {
  return {
    ZoneId: availabilityZoneId,
    ZoneName: zoneName,
    RegionName: region,
    ZoneType: 'availability-zone',
    State: 'available',
    OptInStatus: 'opt-in-not-required',
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {string[]} [availabilityZoneIds] @returns {Record<string, any>} */
function availabilityZonesResponse(
  fixture,
  availabilityZoneIds = [PRIMARY_AZ_ID],
) {
  return {
    AvailabilityZones: availabilityZoneIds.map((id, index) =>
      availabilityZone(
        id,
        fixture.providerScope.region,
        `${fixture.providerScope.region}${String.fromCharCode(97 + index)}`,
      ),
    ),
  };
}

/** @param {string} instanceType @param {string[]} availabilityZoneIds @param {string} [nextToken] @returns {Record<string, any>} */
function offeringsResponse(instanceType, availabilityZoneIds, nextToken) {
  return {
    InstanceTypeOfferings: availabilityZoneIds.map((availabilityZoneId) => ({
      InstanceType: instanceType,
      LocationType: 'availability-zone-id',
      Location: availabilityZoneId,
    })),
    ...(nextToken === undefined ? {} : { NextToken: nextToken }),
  };
}

/** @param {{parameters?: unknown[], images?: unknown[], availabilityZones?: unknown[], offerings?: unknown[], kmsKeys?: unknown[]}} [outcomes] */
function makeClient({
  parameters = [],
  images = [],
  availabilityZones,
  offerings,
  kmsKeys,
} = {}) {
  let parameterIndex = 0;
  let imageIndex = 0;
  let availabilityZoneIndex = 0;
  let offeringIndex = 0;
  let kmsKeyIndex = 0;
  let defaultAvailabilityZoneId = PRIMARY_AZ_ID;
  const getParameter = jest.fn(async (_request) => {
    const outcome = parameters[parameterIndex];
    parameterIndex += 1;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  const describeImages = jest.fn(async (_request) => {
    const outcome = images[imageIndex];
    imageIndex += 1;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  const describeAvailabilityZones = jest.fn(
    async (/** @type {any} */ request) => {
      if (availabilityZones !== undefined) {
        const outcome = availabilityZones[availabilityZoneIndex];
        availabilityZoneIndex += 1;
        if (outcome instanceof Error) throw outcome;
        return outcome;
      }
      const region = request.Filters.find(
        (/** @type {any} */ filter) => filter.Name === 'region-name',
      ).Values[0];
      defaultAvailabilityZoneId = request.ZoneIds?.[0] || PRIMARY_AZ_ID;
      return {
        AvailabilityZones: [
          availabilityZone(defaultAvailabilityZoneId, region),
        ],
      };
    },
  );
  const describeInstanceTypeOfferings = jest.fn(
    async (/** @type {any} */ request) => {
      if (offerings !== undefined) {
        const outcome = offerings[offeringIndex];
        offeringIndex += 1;
        if (outcome instanceof Error) throw outcome;
        return outcome;
      }
      const instanceType = request.Filters.find(
        (/** @type {any} */ filter) => filter.Name === 'instance-type',
      ).Values[0];
      const location = request.Filters.find(
        (/** @type {any} */ filter) => filter.Name === 'location',
      )?.Values[0];
      return offeringsResponse(instanceType, [
        location || defaultAvailabilityZoneId,
      ]);
    },
  );
  const getEbsDefaultKmsKeyId = jest.fn(async (_request) => {
    if (kmsKeys !== undefined) {
      const outcome = kmsKeys[kmsKeyIndex];
      kmsKeyIndex += 1;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }
    return { KmsKeyId: EBS_KMS_KEY_ARN };
  });
  return Object.freeze({
    getParameter,
    describeImages,
    describeAvailabilityZones,
    describeInstanceTypeOfferings,
    getEbsDefaultKmsKeyId,
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {ReturnType<typeof makeClient>} client @param {{maxAttempts?: number, waitForRetry?: (attempt: number) => Promise<void>, bootstrapDigest?: ReturnType<typeof digest>, now?: () => number}} [overrides] */
function makeResolver(fixture, client, overrides = {}) {
  return createAwsSingleNodeProviderSpecResolver({
    client,
    providerScope: fixture.providerScope,
    bootstrapDigest: overrides.bootstrapDigest || digest('bootstrap-v1'),
    now: overrides.now || (() => NOW),
    maxAttempts: overrides.maxAttempts ?? 1,
    waitForRetry: overrides.waitForRetry || (async () => {}),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {number} [version] @param {string} [ebsKmsKeyArn] */
function expectedSpec(fixture, version = 87, ebsKmsKeyArn = EBS_KMS_KEY_ARN) {
  const architecture =
    fixture.profile.target.architecture === 'x64' ? 'x86_64' : 'arm64';
  return createAwsSingleNodeProviderSpec({
    profile: fixture.profile,
    providerScope: fixture.providerScope,
    machineImage: {
      sourceParameter: {
        name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS[architecture],
        version,
      },
      imageId:
        fixture.profile.target.architecture === 'x64' ? X64_AMI : ARM64_AMI,
      ownerAccountId: AMAZON_ACCOUNT_ID,
      architecture,
      imageType: 'machine',
      rootDeviceType: 'ebs',
      virtualizationType: 'hvm',
      enaSupport: true,
    },
    placement: { availabilityZoneId: PRIMARY_AZ_ID },
    storage: { ebsKmsKeyArn },
    bootstrapDigest: digest('bootstrap-v1'),
  });
}

describe('AWS single-node provider-spec resolver', () => {
  it.each([
    ['x64', 'x86_64', X64_AMI, 't3.small'],
    ['arm64', 'arm64', ARM64_AMI, 't4g.small'],
  ])(
    'resolves the fixed %s public parameter into one exact content-addressed specification',
    async (targetArchitecture, imageArchitecture, imageId, instanceType) => {
      const fixture = makeFixture(
        /** @type {'x64'|'arm64'} */ (targetArchitecture),
      );
      const client = makeClient({
        parameters: [parameterResponse(fixture)],
        images: [imageResponse(fixture)],
      });
      const resolver = makeResolver(fixture, client);

      const spec = await resolver.resolveProviderSpec(makeContext(fixture));
      const parameterName =
        AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS[
          /** @type {'x86_64'|'arm64'} */ (imageArchitecture)
        ];
      expect(spec).toEqual(expectedSpec(fixture));
      expect(spec).toMatchObject({
        machineImage: {
          sourceParameter: { name: parameterName, version: 87 },
          imageId,
          architecture: imageArchitecture,
        },
        placement: { availabilityZoneId: PRIMARY_AZ_ID },
        storage: { ebsKmsKeyArn: EBS_KMS_KEY_ARN },
        node: { instanceType },
      });
      expect(Object.isFrozen(spec)).toBe(true);
      expect(client.getParameter).toHaveBeenCalledWith({
        Name: parameterName,
        WithDecryption: false,
      });
      expect(client.describeImages).toHaveBeenCalledWith({
        ImageIds: [imageId],
        Owners: ['amazon'],
        IncludeDeprecated: true,
        IncludeDisabled: true,
      });
      expect(client.describeAvailabilityZones).toHaveBeenCalledWith({
        AllAvailabilityZones: false,
        Filters: [
          { Name: 'region-name', Values: ['us-east-1'] },
          { Name: 'state', Values: ['available'] },
          { Name: 'zone-type', Values: ['availability-zone'] },
        ],
      });
      expect(client.describeInstanceTypeOfferings).toHaveBeenCalledWith({
        LocationType: 'availability-zone-id',
        Filters: [{ Name: 'instance-type', Values: [instanceType] }],
        MaxResults: 1000,
      });
      expect(client.getEbsDefaultKmsKeyId).toHaveBeenCalledWith({});
      expect(Object.isFrozen(resolver)).toBe(true);
    },
  );

  it('paginates all fixed-type offerings and selects the stable lexical available AZ ID', async () => {
    const fixture = makeFixture();
    const client = makeClient({
      parameters: [parameterResponse(fixture)],
      availabilityZones: [
        availabilityZonesResponse(fixture, [SECONDARY_AZ_ID, PRIMARY_AZ_ID]),
      ],
      offerings: [
        offeringsResponse('t3.small', [SECONDARY_AZ_ID], 'page-two'),
        offeringsResponse('t3.small', [PRIMARY_AZ_ID]),
      ],
      images: [imageResponse(fixture)],
    });
    const resolver = makeResolver(fixture, client, {
      now: () => {
        expect(client.describeAvailabilityZones).toHaveBeenCalledTimes(1);
        expect(client.describeInstanceTypeOfferings).toHaveBeenCalledTimes(2);
        expect(client.getEbsDefaultKmsKeyId).toHaveBeenCalledTimes(1);
        return NOW;
      },
    });

    await expect(
      resolver.resolveProviderSpec(makeContext(fixture)),
    ).resolves.toEqual(expectedSpec(fixture));
    expect(client.describeInstanceTypeOfferings.mock.calls).toEqual([
      [
        {
          LocationType: 'availability-zone-id',
          Filters: [{ Name: 'instance-type', Values: ['t3.small'] }],
          MaxResults: 1000,
        },
      ],
      [
        {
          LocationType: 'availability-zone-id',
          Filters: [{ Name: 'instance-type', Values: ['t3.small'] }],
          MaxResults: 1000,
          NextToken: 'page-two',
        },
      ],
    ]);
    expect(client.getParameter).toHaveBeenCalledTimes(1);
    for (const [request] of client.describeInstanceTypeOfferings.mock.calls) {
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(/** @type {any} */ (request).Filters)).toBe(true);
      expect(
        Object.isFrozen(/** @type {any} */ (request).Filters[0].Values),
      ).toBe(true);
    }
  });

  it('validates only the pinned SSM version and reproduces the exact submitted spec', async () => {
    const fixture = makeFixture();
    const spec = expectedSpec(fixture);
    const parameter = parameterResponse(fixture);
    parameter.Parameter.Selector = ':87';
    const client = makeClient({
      parameters: [parameter],
      images: [imageResponse(fixture)],
    });
    const resolver = makeResolver(fixture, client);

    await expect(
      resolver.validateProviderSpec(makeContext(fixture, spec)),
    ).resolves.toEqual(spec);
    expect(client.getParameter).toHaveBeenCalledTimes(1);
    expect(client.getParameter).toHaveBeenCalledWith({
      Name: `${AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64}:87`,
      WithDecryption: false,
    });
    expect(client.describeAvailabilityZones).toHaveBeenCalledWith({
      AllAvailabilityZones: false,
      Filters: [
        { Name: 'region-name', Values: ['us-east-1'] },
        { Name: 'state', Values: ['available'] },
        { Name: 'zone-type', Values: ['availability-zone'] },
      ],
      ZoneIds: [PRIMARY_AZ_ID],
    });
    expect(client.describeInstanceTypeOfferings).toHaveBeenCalledWith({
      LocationType: 'availability-zone-id',
      Filters: [
        { Name: 'instance-type', Values: ['t3.small'] },
        { Name: 'location', Values: [PRIMARY_AZ_ID] },
      ],
      MaxResults: 1000,
    });
    expect(client.getEbsDefaultKmsKeyId).toHaveBeenCalledWith({});
  });

  it('never drifts from the pinned AZ or KMS key during independent validation', async () => {
    const fixture = makeFixture();
    const parameter = parameterResponse(fixture);
    parameter.Parameter.Selector = ':87';
    const wrongZoneClient = makeClient({
      parameters: [parameter],
      availabilityZones: [
        availabilityZonesResponse(fixture, [SECONDARY_AZ_ID]),
      ],
    });

    await expect(
      makeResolver(fixture, wrongZoneClient).validateProviderSpec(
        makeContext(fixture, expectedSpec(fixture)),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
    expect(
      /** @type {any} */ (
        wrongZoneClient.describeAvailabilityZones.mock.calls[0][0]
      ).ZoneIds,
    ).toEqual([PRIMARY_AZ_ID]);
    expect(
      wrongZoneClient.describeInstanceTypeOfferings,
    ).not.toHaveBeenCalled();

    const exactParameter = parameterResponse(fixture);
    exactParameter.Parameter.Selector = ':87';
    const wrongKeyClient = makeClient({
      parameters: [exactParameter],
      kmsKeys: [
        {
          KmsKeyId:
            'arn:aws:kms:us-east-1:123456789012:key/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        },
      ],
    });
    await expect(
      makeResolver(fixture, wrongKeyClient).validateProviderSpec(
        makeContext(fixture, expectedSpec(fixture)),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
    expect(wrongKeyClient.describeImages).not.toHaveBeenCalled();
  });

  it('rejects a versioned response that drifts to another SSM version or AMI', async () => {
    const fixture = makeFixture();
    const client = makeClient({
      parameters: [parameterResponse(fixture, 88, 'ami-aaaaaaaaaaaaaaaaa')],
    });
    const resolver = makeResolver(fixture, client);

    await expect(
      resolver.validateProviderSpec(
        makeContext(fixture, expectedSpec(fixture)),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
    expect(client.describeImages).not.toHaveBeenCalled();
  });

  it.each([
    [
      'name',
      (/** @type {any} */ value) => (value.Parameter.Name = '/wrong/name'),
    ],
    [
      'type',
      (/** @type {any} */ value) => (value.Parameter.Type = 'SecureString'),
    ],
    [
      'data type',
      (/** @type {any} */ value) =>
        (value.Parameter.DataType = 'aws:ec2:image'),
    ],
    [
      'public ARN',
      (/** @type {any} */ value) =>
        (value.Parameter.ARN =
          'arn:aws:ssm:us-east-1:123456789012:parameter/private'),
    ],
    [
      'AMI spelling',
      (/** @type {any} */ value) => (value.Parameter.Value = 'AMI-secret'),
    ],
    [
      'positive version',
      (/** @type {any} */ value) => (value.Parameter.Version = 0),
    ],
    [
      'last-modified date',
      (/** @type {any} */ value) =>
        (value.Parameter.LastModifiedDate = new Date(Number.NaN)),
    ],
    [
      'source result',
      (/** @type {any} */ value) =>
        (value.Parameter.SourceResult = 'secret-source'),
    ],
    [
      'latest selector',
      (/** @type {any} */ value) =>
        (value.Parameter.Selector = `${AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64}:87`),
    ],
  ])('rejects SSM %s drift without contacting EC2', async (_name, mutate) => {
    const fixture = makeFixture();
    const response = parameterResponse(fixture);
    mutate(/** @type {any} */ (response));
    const client = makeClient({ parameters: [response] });
    const resolver = makeResolver(fixture, client);

    await expect(
      resolver.resolveProviderSpec(makeContext(fixture)),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
    expect(client.describeImages).not.toHaveBeenCalled();
  });

  it.each([
    [
      'image ID',
      (/** @type {any} */ value) =>
        (value.Images[0].ImageId = 'ami-aaaaaaaaaaaaaaaaa'),
    ],
    [
      'owner ID',
      (/** @type {any} */ value) => (value.Images[0].OwnerId = '1234'),
    ],
    [
      'owner alias',
      (/** @type {any} */ value) => (value.Images[0].ImageOwnerAlias = 'self'),
    ],
    [
      'public access',
      (/** @type {any} */ value) => (value.Images[0].Public = false),
    ],
    [
      'architecture',
      (/** @type {any} */ value) => (value.Images[0].Architecture = 'arm64'),
    ],
    [
      'image type',
      (/** @type {any} */ value) => (value.Images[0].ImageType = 'kernel'),
    ],
    [
      'root device',
      (/** @type {any} */ value) =>
        (value.Images[0].RootDeviceType = 'instance-store'),
    ],
    [
      'virtualization',
      (/** @type {any} */ value) =>
        (value.Images[0].VirtualizationType = 'paravirtual'),
    ],
    [
      'ENA support',
      (/** @type {any} */ value) => (value.Images[0].EnaSupport = false),
    ],
    [
      'Windows platform',
      (/** @type {any} */ value) => (value.Images[0].Platform = 'windows'),
    ],
    [
      'platform details',
      (/** @type {any} */ value) =>
        (value.Images[0].PlatformDetails = 'Windows'),
    ],
    [
      'public parameter',
      (/** @type {any} */ value) =>
        (value.Images[0].PublicSsmParameterName = '/aws/service/wrong'),
    ],
    [
      'allowed-image policy',
      (/** @type {any} */ value) => (value.Images[0].ImageAllowed = false),
    ],
    [
      'expired deprecation',
      (/** @type {any} */ value) =>
        (value.Images[0].DeprecationTime = '2025-12-31T23:59:59Z'),
    ],
    [
      'invalid deprecation',
      (/** @type {any} */ value) =>
        (value.Images[0].DeprecationTime = '2027-02-30T00:00:00Z'),
    ],
  ])('rejects EC2 %s drift immediately', async (_name, mutate) => {
    const fixture = makeFixture();
    const response = imageResponse(fixture);
    mutate(/** @type {any} */ (response));
    const waitForRetry = jest.fn(async (/** @type {number} */ _attempt) => {});
    const client = makeClient({
      parameters: [parameterResponse(fixture)],
      images: [response],
    });
    const resolver = makeResolver(fixture, client, {
      maxAttempts: 3,
      waitForRetry,
    });

    await expect(
      resolver.resolveProviderSpec(makeContext(fixture)),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
    expect(client.describeImages).toHaveBeenCalledTimes(1);
    expect(waitForRetry).not.toHaveBeenCalled();
  });

  it('accepts an absent ImageAllowed/DeprecationTime and a strict UTC deprecation with fractional seconds', async () => {
    const fixture = makeFixture();
    const withoutOptional = imageResponse(fixture);
    delete withoutOptional.Images[0].ImageAllowed;
    delete withoutOptional.Images[0].DeprecationTime;
    const client = makeClient({
      parameters: [parameterResponse(fixture), parameterResponse(fixture)],
      images: [
        withoutOptional,
        imageResponse(fixture, 'available', '2027-01-01T00:00:00.1Z'),
      ],
    });
    const resolver = makeResolver(fixture, client);

    await expect(
      resolver.resolveProviderSpec(makeContext(fixture)),
    ).resolves.toEqual(expectedSpec(fixture));
    await expect(
      resolver.resolveProviderSpec(makeContext(fixture)),
    ).resolves.toEqual(expectedSpec(fixture));
  });

  it('retries unknown SSM reads with one identical latest selector before freezing the first success', async () => {
    const fixture = makeFixture();
    /** @type {number[]} */
    const waits = [];
    const client = makeClient({
      parameters: [new Error('secret SSM failure'), parameterResponse(fixture)],
      images: [imageResponse(fixture)],
    });
    const resolver = makeResolver(fixture, client, {
      maxAttempts: 3,
      waitForRetry: async (attempt) => {
        waits.push(attempt);
      },
    });

    await expect(
      resolver.resolveProviderSpec(makeContext(fixture)),
    ).resolves.toEqual(expectedSpec(fixture));
    expect(client.getParameter).toHaveBeenCalledTimes(2);
    expect(client.getParameter.mock.calls[0][0]).toEqual(
      client.getParameter.mock.calls[1][0],
    );
    expect(client.describeImages).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([1]);
  });

  it('retries a malformed successful SSM envelope and exhausts as unknown', async () => {
    const fixture = makeFixture();
    /** @type {number[]} */
    const waits = [];
    const client = makeClient({ parameters: [{}, { Parameter: null }] });
    const resolver = makeResolver(fixture, client, {
      maxAttempts: 2,
      waitForRetry: async (attempt) => {
        waits.push(attempt);
      },
    });

    await expect(
      resolver.resolveProviderSpec(makeContext(fixture)),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecUnknownError);
    expect(client.getParameter).toHaveBeenCalledTimes(2);
    expect(client.describeImages).not.toHaveBeenCalled();
    expect(waits).toEqual([1]);
  });

  it.each(['ParameterNotFound', 'ParameterVersionNotFound'])(
    'classifies %s as immediate missing evidence',
    async (name) => {
      const fixture = makeFixture();
      const error = new Error('secret provider detail');
      error.name = name;
      const waitForRetry = jest.fn(
        async (/** @type {number} */ _attempt) => {},
      );
      const client = makeClient({ parameters: [error] });
      const resolver = makeResolver(fixture, client, {
        maxAttempts: 3,
        waitForRetry,
      });

      const caught = await resolver
        .resolveProviderSpec(makeContext(fixture))
        .catch((failure) => failure);
      expect(caught).toBeInstanceOf(AwsSingleNodeProviderSpecMissingError);
      expect(caught).toMatchObject({
        code: 'AWS_SINGLE_NODE_PROVIDER_SPEC_MISSING',
        message: 'Required AWS provider-spec discovery evidence is absent.',
      });
      expect(JSON.stringify(caught)).not.toContain('secret');
      expect(client.getParameter).toHaveBeenCalledTimes(1);
      expect(client.describeImages).not.toHaveBeenCalled();
      expect(waitForRetry).not.toHaveBeenCalled();
    },
  );

  it('classifies a complete empty standard-AZ result as missing without further discovery', async () => {
    const fixture = makeFixture();
    const client = makeClient({
      parameters: [parameterResponse(fixture)],
      availabilityZones: [{ AvailabilityZones: [] }],
    });

    await expect(
      makeResolver(fixture, client).resolveProviderSpec(makeContext(fixture)),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecMissingError);
    expect(client.describeAvailabilityZones).toHaveBeenCalledTimes(1);
    expect(client.describeInstanceTypeOfferings).not.toHaveBeenCalled();
    expect(client.getEbsDefaultKmsKeyId).not.toHaveBeenCalled();
    expect(client.describeImages).not.toHaveBeenCalled();
  });

  it.each([
    ['missing envelope', {}],
    ['null zone list', { AvailabilityZones: null }],
    ['malformed zone', { AvailabilityZones: [null] }],
    [
      'missing zone field',
      {
        AvailabilityZones: [
          {
            ZoneId: PRIMARY_AZ_ID,
            ZoneName: 'us-east-1a',
            RegionName: 'us-east-1',
            ZoneType: 'availability-zone',
            State: 'available',
          },
        ],
      },
    ],
  ])(
    'retries malformed Availability Zone %s and exhausts unknown',
    async (_name, outcome) => {
      const fixture = makeFixture();
      const waitForRetry = jest.fn(
        async (/** @type {number} */ _attempt) => {},
      );
      const client = makeClient({
        parameters: [parameterResponse(fixture)],
        availabilityZones: [outcome, outcome],
      });
      await expect(
        makeResolver(fixture, client, {
          maxAttempts: 2,
          waitForRetry,
        }).resolveProviderSpec(makeContext(fixture)),
      ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecUnknownError);
      expect(client.describeAvailabilityZones).toHaveBeenCalledTimes(2);
      expect(client.describeAvailabilityZones.mock.calls[0][0]).toEqual(
        client.describeAvailabilityZones.mock.calls[1][0],
      );
      expect(waitForRetry).toHaveBeenCalledWith(1);
    },
  );

  it.each([
    [
      'nonavailable state',
      (/** @type {any} */ zone) => (zone.State = 'constrained'),
    ],
    [
      'nonstandard zone type',
      (/** @type {any} */ zone) => (zone.ZoneType = 'local-zone'),
    ],
    [
      'invalid opt-in state',
      (/** @type {any} */ zone) => (zone.OptInStatus = 'opted-in'),
    ],
    [
      'wrong region',
      (/** @type {any} */ zone) => (zone.RegionName = 'us-west-2'),
    ],
    [
      'parent zone',
      (/** @type {any} */ zone) => (zone.ParentZoneId = 'use1-az1'),
    ],
  ])(
    'rejects Availability Zone %s as immediate conflict',
    async (_name, mutate) => {
      const fixture = makeFixture();
      const response = availabilityZonesResponse(fixture);
      mutate(response.AvailabilityZones[0]);
      const waitForRetry = jest.fn(
        async (/** @type {number} */ _attempt) => {},
      );
      const client = makeClient({
        parameters: [parameterResponse(fixture)],
        availabilityZones: [response],
      });
      await expect(
        makeResolver(fixture, client, {
          maxAttempts: 3,
          waitForRetry,
        }).resolveProviderSpec(makeContext(fixture)),
      ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
      expect(client.describeAvailabilityZones).toHaveBeenCalledTimes(1);
      expect(waitForRetry).not.toHaveBeenCalled();
    },
  );

  it('classifies a complete empty fixed-instance offering result as missing', async () => {
    const fixture = makeFixture();
    const client = makeClient({
      parameters: [parameterResponse(fixture)],
      offerings: [{ InstanceTypeOfferings: [] }],
    });
    await expect(
      makeResolver(fixture, client).resolveProviderSpec(makeContext(fixture)),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecMissingError);
    expect(client.describeInstanceTypeOfferings).toHaveBeenCalledTimes(1);
    expect(client.getEbsDefaultKmsKeyId).not.toHaveBeenCalled();
  });

  it.each([
    ['missing envelope', {}],
    ['null offerings', { InstanceTypeOfferings: null }],
    ['malformed offering', { InstanceTypeOfferings: [null] }],
    [
      'missing offering field',
      {
        InstanceTypeOfferings: [
          {
            InstanceType: 't3.small',
            LocationType: 'availability-zone-id',
          },
        ],
      },
    ],
  ])(
    'retries malformed instance-type offering %s and exhausts unknown',
    async (_name, outcome) => {
      const fixture = makeFixture();
      const waitForRetry = jest.fn(
        async (/** @type {number} */ _attempt) => {},
      );
      const client = makeClient({
        parameters: [parameterResponse(fixture)],
        offerings: [outcome, outcome],
      });
      await expect(
        makeResolver(fixture, client, {
          maxAttempts: 2,
          waitForRetry,
        }).resolveProviderSpec(makeContext(fixture)),
      ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecUnknownError);
      expect(client.describeInstanceTypeOfferings).toHaveBeenCalledTimes(2);
      expect(client.describeInstanceTypeOfferings.mock.calls[0][0]).toEqual(
        client.describeInstanceTypeOfferings.mock.calls[1][0],
      );
      expect(waitForRetry).toHaveBeenCalledWith(1);
    },
  );

  it.each([
    [
      'instance type',
      (/** @type {any} */ offering) => (offering.InstanceType = 't3.medium'),
    ],
    [
      'location type',
      (/** @type {any} */ offering) =>
        (offering.LocationType = 'availability-zone'),
    ],
    [
      'location',
      (/** @type {any} */ offering) => (offering.Location = 'us-east-1a'),
    ],
  ])(
    'rejects instance-type offering %s drift immediately',
    async (_name, mutate) => {
      const fixture = makeFixture();
      const response = offeringsResponse('t3.small', [PRIMARY_AZ_ID]);
      mutate(response.InstanceTypeOfferings[0]);
      const waitForRetry = jest.fn(async () => {});
      const client = makeClient({
        parameters: [parameterResponse(fixture)],
        offerings: [response],
      });
      await expect(
        makeResolver(fixture, client, {
          maxAttempts: 3,
          waitForRetry,
        }).resolveProviderSpec(makeContext(fixture)),
      ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
      expect(client.describeInstanceTypeOfferings).toHaveBeenCalledTimes(1);
      expect(waitForRetry).not.toHaveBeenCalled();
    },
  );

  it('freezes completed offering pages while retrying only one malformed continuation', async () => {
    const fixture = makeFixture();
    /** @type {number[]} */
    const waits = [];
    const client = makeClient({
      parameters: [parameterResponse(fixture)],
      availabilityZones: [
        availabilityZonesResponse(fixture, [PRIMARY_AZ_ID, SECONDARY_AZ_ID]),
      ],
      offerings: [
        offeringsResponse('t3.small', [SECONDARY_AZ_ID], 'continuation'),
        {},
        offeringsResponse('t3.small', [PRIMARY_AZ_ID]),
      ],
      images: [imageResponse(fixture)],
    });
    const resolver = makeResolver(fixture, client, {
      maxAttempts: 2,
      waitForRetry: async (attempt) => {
        waits.push(attempt);
      },
    });

    await expect(
      resolver.resolveProviderSpec(makeContext(fixture)),
    ).resolves.toEqual(expectedSpec(fixture));
    expect(client.describeAvailabilityZones).toHaveBeenCalledTimes(1);
    expect(client.describeInstanceTypeOfferings).toHaveBeenCalledTimes(3);
    expect(client.describeInstanceTypeOfferings.mock.calls[1][0]).toEqual(
      client.describeInstanceTypeOfferings.mock.calls[2][0],
    );
    expect(client.describeInstanceTypeOfferings.mock.calls[0][0]).not.toEqual(
      client.describeInstanceTypeOfferings.mock.calls[1][0],
    );
    expect(waits).toEqual([1]);
  });

  it('bounds cyclic offering pagination as unknown without restarting discovery', async () => {
    const fixture = makeFixture();
    const client = makeClient({
      parameters: [parameterResponse(fixture)],
      offerings: [
        offeringsResponse('t3.small', [PRIMARY_AZ_ID], 'same-token'),
        offeringsResponse('t3.small', [SECONDARY_AZ_ID], 'same-token'),
      ],
    });
    await expect(
      makeResolver(fixture, client).resolveProviderSpec(makeContext(fixture)),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecUnknownError);
    expect(client.getParameter).toHaveBeenCalledTimes(1);
    expect(client.describeAvailabilityZones).toHaveBeenCalledTimes(1);
    expect(client.describeInstanceTypeOfferings).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate AZ and offering evidence as conflict', async () => {
    const fixture = makeFixture();
    const duplicatedZone = availabilityZone(
      PRIMARY_AZ_ID,
      fixture.providerScope.region,
    );
    const duplicateZoneClient = makeClient({
      parameters: [parameterResponse(fixture)],
      availabilityZones: [
        { AvailabilityZones: [duplicatedZone, { ...duplicatedZone }] },
      ],
    });
    await expect(
      makeResolver(fixture, duplicateZoneClient).resolveProviderSpec(
        makeContext(fixture),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);

    const duplicateOfferingClient = makeClient({
      parameters: [parameterResponse(fixture)],
      offerings: [
        offeringsResponse('t3.small', [PRIMARY_AZ_ID], 'next'),
        offeringsResponse('t3.small', [PRIMARY_AZ_ID]),
      ],
    });
    await expect(
      makeResolver(fixture, duplicateOfferingClient).resolveProviderSpec(
        makeContext(fixture),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
  });

  it('retries the identical default-EBS-key read across failures and malformed success', async () => {
    const fixture = makeFixture();
    /** @type {number[]} */
    const waits = [];
    const client = makeClient({
      parameters: [parameterResponse(fixture)],
      kmsKeys: [
        new Error('secret KMS failure'),
        {},
        { KmsKeyId: EBS_KMS_KEY_ARN },
      ],
      images: [imageResponse(fixture)],
    });
    const resolver = makeResolver(fixture, client, {
      maxAttempts: 3,
      waitForRetry: async (attempt) => {
        waits.push(attempt);
      },
    });

    await expect(
      resolver.resolveProviderSpec(makeContext(fixture)),
    ).resolves.toEqual(expectedSpec(fixture));
    expect(client.getEbsDefaultKmsKeyId).toHaveBeenCalledTimes(3);
    expect(client.getEbsDefaultKmsKeyId.mock.calls).toEqual([[{}], [{}], [{}]]);
    expect(Object.isFrozen(client.getEbsDefaultKmsKeyId.mock.calls[0][0])).toBe(
      true,
    );
    expect(waits).toEqual([1, 2]);
  });

  it.each([null, {}, { KmsKeyId: undefined }])(
    'retries malformed default-EBS-key envelope %# and exhausts unknown',
    async (outcome) => {
      const fixture = makeFixture();
      const waitForRetry = jest.fn(
        async (/** @type {number} */ _attempt) => {},
      );
      const client = makeClient({
        parameters: [parameterResponse(fixture)],
        kmsKeys: [outcome, outcome],
      });
      await expect(
        makeResolver(fixture, client, {
          maxAttempts: 2,
          waitForRetry,
        }).resolveProviderSpec(makeContext(fixture)),
      ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecUnknownError);
      expect(client.getEbsDefaultKmsKeyId).toHaveBeenCalledTimes(2);
      expect(client.getEbsDefaultKmsKeyId.mock.calls).toEqual([[{}], [{}]]);
      expect(waitForRetry).toHaveBeenCalledWith(1);
      expect(client.describeImages).not.toHaveBeenCalled();
    },
  );

  it('accepts an exact scoped multi-Region KMS key ARN', async () => {
    const fixture = makeFixture();
    const multiRegionKeyArn =
      'arn:aws:kms:us-east-1:123456789012:key/mrk-11111111222222223333333344444444';
    const client = makeClient({
      parameters: [parameterResponse(fixture)],
      kmsKeys: [{ KmsKeyId: multiRegionKeyArn }],
      images: [imageResponse(fixture)],
    });
    await expect(
      makeResolver(fixture, client).resolveProviderSpec(makeContext(fixture)),
    ).resolves.toEqual(expectedSpec(fixture, 87, multiRegionKeyArn));
  });

  it.each([
    ['bare alias', 'alias/aws/ebs'],
    ['alias ARN', 'arn:aws:kms:us-east-1:123456789012:alias/aws/ebs'],
    [
      'wrong partition',
      'arn:aws-cn:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    ],
    [
      'wrong region',
      'arn:aws:kms:us-west-2:123456789012:key/11111111-2222-3333-4444-555555555555',
    ],
    [
      'wrong account',
      'arn:aws:kms:us-east-1:210987654321:key/11111111-2222-3333-4444-555555555555',
    ],
  ])(
    'rejects default EBS KMS key %s as immediate conflict',
    async (_name, kmsKeyId) => {
      const fixture = makeFixture();
      const waitForRetry = jest.fn(async () => {});
      const client = makeClient({
        parameters: [parameterResponse(fixture)],
        kmsKeys: [{ KmsKeyId: kmsKeyId }],
      });
      await expect(
        makeResolver(fixture, client, {
          maxAttempts: 3,
          waitForRetry,
        }).resolveProviderSpec(makeContext(fixture)),
      ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
      expect(client.getEbsDefaultKmsKeyId).toHaveBeenCalledTimes(1);
      expect(client.describeImages).not.toHaveBeenCalled();
      expect(waitForRetry).not.toHaveBeenCalled();
    },
  );

  it('freezes the successful SSM candidate while EC2 moves from an incomplete pending image to available', async () => {
    const fixture = makeFixture();
    const pending = { Images: [{ ImageId: X64_AMI, State: 'pending' }] };
    /** @type {number[]} */
    const waits = [];
    const client = makeClient({
      parameters: [parameterResponse(fixture)],
      images: [pending, imageResponse(fixture)],
    });
    const resolver = makeResolver(fixture, client, {
      maxAttempts: 3,
      waitForRetry: async (attempt) => {
        waits.push(attempt);
      },
    });

    await expect(
      resolver.resolveProviderSpec(makeContext(fixture)),
    ).resolves.toEqual(expectedSpec(fixture));
    expect(client.getParameter).toHaveBeenCalledTimes(1);
    expect(client.describeImages).toHaveBeenCalledTimes(2);
    expect(client.describeImages.mock.calls[0][0]).toEqual(
      client.describeImages.mock.calls[1][0],
    );
    expect(waits).toEqual([1]);
  });

  it.each([
    ['empty response', { Images: [] }],
    ['transient state', { Images: [{ ImageId: X64_AMI, State: 'transient' }] }],
    ['provider failure', new Error('secret invalid AMI or access policy')],
  ])(
    'bounds ambiguous EC2 %s and exhausts as unknown',
    async (_name, outcome) => {
      const fixture = makeFixture();
      /** @type {number[]} */
      const waits = [];
      const client = makeClient({
        parameters: [parameterResponse(fixture)],
        images: [outcome, outcome, outcome],
      });
      const resolver = makeResolver(fixture, client, {
        maxAttempts: 3,
        waitForRetry: async (attempt) => {
          waits.push(attempt);
        },
      });

      const caught = await resolver
        .resolveProviderSpec(makeContext(fixture))
        .catch((failure) => failure);
      expect(caught).toBeInstanceOf(AwsSingleNodeProviderSpecUnknownError);
      expect(caught).toMatchObject({
        code: 'AWS_SINGLE_NODE_PROVIDER_SPEC_UNKNOWN',
        message: 'AWS provider-spec discovery state is unknown.',
      });
      expect(JSON.stringify(caught)).not.toContain('secret');
      expect(client.getParameter).toHaveBeenCalledTimes(1);
      expect(client.describeImages).toHaveBeenCalledTimes(3);
      expect(waits).toEqual([1, 2]);
    },
  );

  it.each([null, {}, { Images: null }, { Images: [null] }])(
    'retries malformed successful EC2 envelope %# and exhausts as unknown',
    async (outcome) => {
      const fixture = makeFixture();
      const client = makeClient({
        parameters: [parameterResponse(fixture)],
        images: [outcome, outcome],
      });
      const waitForRetry = jest.fn(
        async (/** @type {number} */ _attempt) => {},
      );
      const resolver = makeResolver(fixture, client, {
        maxAttempts: 2,
        waitForRetry,
      });

      await expect(
        resolver.resolveProviderSpec(makeContext(fixture)),
      ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecUnknownError);
      expect(client.describeImages).toHaveBeenCalledTimes(2);
      expect(waitForRetry).toHaveBeenCalledWith(1);
    },
  );

  it('resamples the clock after EC2 success before admitting deprecation', async () => {
    const fixture = makeFixture();
    const samples = [NOW, Date.parse('2027-01-01T00:00:00.000Z')];
    const client = makeClient({
      parameters: [parameterResponse(fixture)],
      images: [
        { Images: [{ ImageId: X64_AMI, State: 'pending' }] },
        imageResponse(fixture, 'available', '2027-01-01T00:00:00Z'),
      ],
    });
    const resolver = makeResolver(fixture, client, {
      maxAttempts: 2,
      now: () => /** @type {number} */ (samples.shift()),
    });

    await expect(
      resolver.resolveProviderSpec(makeContext(fixture)),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
    expect(samples).toEqual([]);
  });

  it('rejects multiple EC2 matches and pagination as immediate conflict', async () => {
    const fixture = makeFixture();
    const image = imageResponse(fixture).Images[0];
    const waitForRetry = jest.fn(async () => {});
    const client = makeClient({
      parameters: [parameterResponse(fixture), parameterResponse(fixture)],
      images: [
        { Images: [image, { ...image }] },
        { Images: [image], NextToken: 'secret-next-page' },
      ],
    });
    const resolver = makeResolver(fixture, client, {
      maxAttempts: 3,
      waitForRetry,
    });

    await expect(
      resolver.resolveProviderSpec(makeContext(fixture)),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
    await expect(
      resolver.resolveProviderSpec(makeContext(fixture)),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
    expect(waitForRetry).not.toHaveBeenCalled();
  });

  it('maps SSM, EC2, and wait exhaustion to fixed non-echoing unknown failures', async () => {
    const fixture = makeFixture();
    const ssmClient = makeClient({
      parameters: [new Error('AKIA-ssm-secret'), new Error('AKIA-ssm-secret')],
    });
    const ssmResolver = makeResolver(fixture, ssmClient, { maxAttempts: 2 });
    const ssmFailure = await ssmResolver
      .resolveProviderSpec(makeContext(fixture))
      .catch((failure) => failure);

    const ec2Client = makeClient({
      parameters: [parameterResponse(fixture)],
      images: [new Error('AKIA-ec2-secret')],
    });
    const ec2Resolver = makeResolver(fixture, ec2Client);
    const ec2Failure = await ec2Resolver
      .resolveProviderSpec(makeContext(fixture))
      .catch((failure) => failure);

    const waitClient = makeClient({ parameters: [new Error('retry me')] });
    const waitResolver = makeResolver(fixture, waitClient, {
      maxAttempts: 2,
      waitForRetry: async () => {
        throw new Error('AKIA-wait-secret');
      },
    });
    const waitFailure = await waitResolver
      .resolveProviderSpec(makeContext(fixture))
      .catch((failure) => failure);

    for (const failure of [ssmFailure, ec2Failure, waitFailure]) {
      expect(failure).toBeInstanceOf(AwsSingleNodeProviderSpecUnknownError);
      expect(failure.message).toBe(
        'AWS provider-spec discovery state is unknown.',
      );
      expect(failure.cause).toBeUndefined();
      expect(`${failure.name}:${failure.message}`).not.toMatch(/AKIA|secret/);
    }
  });

  it('rejects provider-scope mismatch before any provider call', async () => {
    const configured = makeFixture();
    const other = makeFixture('x64', 'us-west-2');
    const client = makeClient();
    const resolver = makeResolver(configured, client);

    await expect(
      resolver.resolveProviderSpec(makeContext(other)),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
    expect(client.getParameter).not.toHaveBeenCalled();
  });

  it('classifies an invalid post-EC2 clock sample as unknown', async () => {
    const fixture = makeFixture();
    const client = makeClient({
      parameters: [parameterResponse(fixture)],
      images: [imageResponse(fixture)],
    });
    const badClock = makeResolver(fixture, client, {
      maxAttempts: 3,
      now: () => -1,
    });
    await expect(
      badClock.resolveProviderSpec(makeContext(fixture)),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecUnknownError);
    expect(client.getParameter).toHaveBeenCalledTimes(1);
    expect(client.describeImages).toHaveBeenCalledTimes(1);
  });

  it('permits a fresh incarnation over a DESTROYED head with retained old-incarnation bindings', async () => {
    const fixture = makeFixture();
    const oldIncarnationId = createDeploymentIncarnationId(Buffer.alloc(32, 8));
    const actionId = semanticId('wda3', 'wharfie:test:action:v1', {
      action: 1,
    });
    const head = createDeploymentHead({
      deploymentInstanceId: fixture.deploymentInstanceId,
      providerScope: fixture.providerScope,
      incarnationId: oldIncarnationId,
      generation: 9,
      phase: 'DESTROYED',
      settledDeploymentRevisionId: null,
      targetDeploymentRevisionId: null,
      resourceBindings: [
        createDeploymentResourceBinding({
          schemaVersion: 2,
          kind: 'deploymentResourceBinding',
          deploymentInstanceId: fixture.deploymentInstanceId,
          incarnationId: oldIncarnationId,
          resourceKey: 'application-state',
          capability: { kind: 'application-state', version: 1 },
          role: { kind: 'volume', version: 1 },
          management: 'external',
          ownershipMode: 'external',
          onDestroy: 'retain',
          dependencyBindings: [],
          providerType: 'ebs-volume',
          providerResourceId: 'vol-0123456789abcdef0',
          providerScopeId: fixture.providerScope.providerScopeId,
        }),
      ],
      activeOperation: null,
      lastOperation: {
        kind: 'destroy',
        planId: semanticId('wpl3', 'wharfie:test:plan:v1', { plan: 1 }),
        intents: [{ actionId, status: 'settled', ownershipNonce: null }],
      },
    });
    const context = { ...makeContext(fixture), head };
    const client = makeClient({
      parameters: [parameterResponse(fixture)],
      images: [imageResponse(fixture)],
    });
    const resolver = makeResolver(fixture, client);

    await expect(resolver.resolveProviderSpec(context)).resolves.toEqual(
      expectedSpec(fixture),
    );
  });

  it('preflights accepted or same-incarnation heads without provider reads', async () => {
    const fixture = makeFixture();
    const actionId = semanticId('wda3', 'wharfie:test:action:v1', {
      action: 2,
    });
    const destroyed = createDeploymentHead({
      deploymentInstanceId: fixture.deploymentInstanceId,
      providerScope: fixture.providerScope,
      incarnationId: fixture.incarnationId,
      generation: 3,
      phase: 'DESTROYED',
      settledDeploymentRevisionId: null,
      targetDeploymentRevisionId: null,
      resourceBindings: [],
      activeOperation: null,
      lastOperation: {
        kind: 'destroy',
        planId: semanticId('wpl3', 'wharfie:test:plan:v1', { plan: 2 }),
        intents: [{ actionId, status: 'settled', ownershipNonce: null }],
      },
    });
    const client = makeClient();
    const resolver = makeResolver(fixture, client);

    await expect(
      resolver.resolveProviderSpec({
        ...makeContext(fixture),
        head: destroyed,
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
    expect(client.getParameter).not.toHaveBeenCalled();
  });

  it('reproduces the bootstrap digest and rejects a valid spec pinned to different behavior', async () => {
    const fixture = makeFixture();
    const spec = createAwsSingleNodeProviderSpec({
      profile: fixture.profile,
      providerScope: fixture.providerScope,
      machineImage: expectedSpec(fixture).machineImage,
      placement: { availabilityZoneId: PRIMARY_AZ_ID },
      storage: { ebsKmsKeyArn: EBS_KMS_KEY_ARN },
      bootstrapDigest: digest('different-bootstrap'),
    });
    const parameter = parameterResponse(fixture);
    parameter.Parameter.Selector = ':87';
    const client = makeClient({
      parameters: [parameter],
      images: [imageResponse(fixture)],
    });
    const resolver = makeResolver(fixture, client);

    await expect(
      resolver.validateProviderSpec(makeContext(fixture, spec)),
    ).rejects.toBeInstanceOf(AwsSingleNodeProviderSpecConflictError);
    expect(client.getParameter).toHaveBeenCalledTimes(1);
    expect(client.describeImages).toHaveBeenCalledTimes(1);
  });

  it('validates the exact bounded factory surface', () => {
    const fixture = makeFixture();
    const client = makeClient();
    const base = {
      client,
      providerScope: fixture.providerScope,
      bootstrapDigest: digest('bootstrap-v1'),
      now: () => NOW,
    };

    expect(() =>
      createAwsSingleNodeProviderSpecResolver({ ...base, maxAttempts: 0 }),
    ).toThrow(/maxAttempts/);
    expect(() =>
      createAwsSingleNodeProviderSpecResolver({ ...base, maxAttempts: 11 }),
    ).toThrow(/maxAttempts/);
    expect(() =>
      createAwsSingleNodeProviderSpecResolver({ ...base, extra: true }),
    ).toThrow(/extra/);
    expect(() =>
      createAwsSingleNodeProviderSpecResolver({
        ...base,
        runtimeIdentityPolicyDigest: digest('caller-selected-runtime-policy'),
      }),
    ).toThrow(/runtimeIdentityPolicyDigest is not supported/i);
    expect(() =>
      createAwsSingleNodeProviderSpecResolver({
        ...base,
        client: { getParameter: async () => ({}) },
      }),
    ).toThrow(/describeImages/);
    expect(AWS_SINGLE_NODE_PROVIDER_SPEC_RESOLVER_DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(AWS_SINGLE_NODE_PROVIDER_SPEC_RESOLVER_MAX_ATTEMPTS).toBe(10);
  });
});
