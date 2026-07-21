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

/** @param {{parameters?: unknown[], images?: unknown[]}} [outcomes] */
function makeClient({ parameters = [], images = [] } = {}) {
  let parameterIndex = 0;
  let imageIndex = 0;
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
  return Object.freeze({ getParameter, describeImages });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {ReturnType<typeof makeClient>} client @param {{maxAttempts?: number, waitForRetry?: (attempt: number) => Promise<void>, bootstrapDigest?: ReturnType<typeof digest>, runtimeIdentityPolicyDigest?: ReturnType<typeof digest>, now?: () => number}} [overrides] */
function makeResolver(fixture, client, overrides = {}) {
  return createAwsSingleNodeProviderSpecResolver({
    client,
    providerScope: fixture.providerScope,
    bootstrapDigest: overrides.bootstrapDigest || digest('bootstrap-v1'),
    runtimeIdentityPolicyDigest:
      overrides.runtimeIdentityPolicyDigest || digest('runtime-policy-v1'),
    now: overrides.now || (() => NOW),
    maxAttempts: overrides.maxAttempts ?? 1,
    waitForRetry: overrides.waitForRetry || (async () => {}),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {number} [version] */
function expectedSpec(fixture, version = 87) {
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
    bootstrapDigest: digest('bootstrap-v1'),
    runtimeIdentityPolicyDigest: digest('runtime-policy-v1'),
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
      expect(Object.isFrozen(resolver)).toBe(true);
    },
  );

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
    const actionId = semanticId('wda2', 'wharfie:test:action:v1', {
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
          schemaVersion: 1,
          kind: 'deploymentResourceBinding',
          deploymentInstanceId: fixture.deploymentInstanceId,
          incarnationId: oldIncarnationId,
          resourceKey: 'application-state',
          capability: { kind: 'application-state', version: 1 },
          management: 'external',
          providerType: 'ebs-volume',
          providerResourceId: 'vol-0123456789abcdef0',
          providerScopeId: fixture.providerScope.providerScopeId,
        }),
      ],
      activeOperation: null,
      lastOperation: {
        kind: 'destroy',
        planId: semanticId('wpl2', 'wharfie:test:plan:v1', { plan: 1 }),
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
    const actionId = semanticId('wda2', 'wharfie:test:action:v1', {
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
        planId: semanticId('wpl2', 'wharfie:test:plan:v1', { plan: 2 }),
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

  it('reproduces behavior digests and rejects a valid spec pinned to different behavior', async () => {
    const fixture = makeFixture();
    const spec = createAwsSingleNodeProviderSpec({
      profile: fixture.profile,
      providerScope: fixture.providerScope,
      machineImage: expectedSpec(fixture).machineImage,
      bootstrapDigest: digest('different-bootstrap'),
      runtimeIdentityPolicyDigest: digest('different-runtime-policy'),
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
      runtimeIdentityPolicyDigest: digest('runtime-policy-v1'),
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
        client: { getParameter: async () => ({}) },
      }),
    ).toThrow(/describeImages/);
    expect(AWS_SINGLE_NODE_PROVIDER_SPEC_RESOLVER_DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(AWS_SINGLE_NODE_PROVIDER_SPEC_RESOLVER_MAX_ATTEMPTS).toBe(10);
  });
});
