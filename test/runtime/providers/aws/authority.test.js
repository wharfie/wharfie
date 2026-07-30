import { describe, expect, it, jest } from '@jest/globals';

import {
  AwsSingleNodeAuthorityInitializationError,
  AwsSingleNodeReadError,
  AwsSingleNodeScopeResolutionError,
  createAwsSingleNodeReadAuthorityFactory,
} from '../../../../src/core/runtime/providers/aws/authority.js';

const REGION = 'us-east-2';
const ACCOUNT_ID = '123456789012';

function identity(accountId = ACCOUNT_ID, partition = 'aws') {
  return {
    Account: accountId,
    Arn: `arn:${partition}:sts::${accountId}:assumed-role/operator/session`,
    UserId: 'safe-user-id',
  };
}

/**
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function makeHarness(overrides = {}) {
  const sts = {
    getCallerIdentity: jest.fn(async () => identity()),
    close: jest.fn(async () => {}),
  };
  const ec2 = {
    describeImages: jest.fn(async (request) => ({ request })),
    describeInstanceAttribute: jest.fn(async (request) => ({ request })),
    describeInstanceCreditSpecifications: jest.fn(async (request) => ({
      request,
    })),
    describeInstanceTypeOfferings: jest.fn(async (request) => ({ request })),
    describeInstances: jest.fn(async (request) => ({ request })),
    describeInternetGateways: jest.fn(async (request) => ({ request })),
    describeNetworkAcls: jest.fn(async (request) => ({ request })),
    describeRouteTables: jest.fn(async (request) => ({ request })),
    describeSecurityGroups: jest.fn(async (request) => ({ request })),
    describeSubnets: jest.fn(async (request) => ({ request })),
    describeVolumes: jest.fn(async (request) => ({ request })),
    describeVpcs: jest.fn(async (request) => ({ request })),
    close: jest.fn(async () => {}),
  };
  const dependencies = {
    resolveCredentials: jest.fn(async () => ({
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret-credential-sentinel',
      sessionToken: 'session-credential-sentinel',
      expiration: new Date('2030-01-01T00:00:00.000Z'),
    })),
    createStsClient: jest.fn(async () => sts),
    createEc2Client: jest.fn(async () => ec2),
    ...overrides,
  };
  return {
    sts,
    ec2,
    dependencies,
    open: createAwsSingleNodeReadAuthorityFactory(dependencies),
  };
}

describe('AWS single-node read authority', () => {
  it('binds ordinary credentials to exact STS scope and read-only clients', async () => {
    const harness = makeHarness();
    const authority = await harness.open({ region: REGION });

    expect(authority).toMatchObject({
      schemaVersion: 1,
      kind: 'awsSingleNodeReadAuthority',
      providerScope: {
        provider: 'aws',
        partition: 'aws',
        accountId: ACCOUNT_ID,
        region: REGION,
        providerScopeId: expect.stringMatching(/^wps1_[A-Za-z0-9_-]{43}$/u),
      },
    });
    expect(Object.keys(authority.api).sort()).toEqual(
      [
        'describeImages',
        'describeInstanceAttribute',
        'describeInstanceCreditSpecifications',
        'describeInstanceTypeOfferings',
        'describeInstances',
        'describeInternetGateways',
        'describeNetworkAcls',
        'describeRouteTables',
        'describeSecurityGroups',
        'describeSubnets',
        'describeVolumes',
        'describeVpcs',
      ].sort(),
    );
    expect(authority.api.createSecurityGroup).toBeUndefined();
    await expect(authority.api.describeVpcs({ Filters: [] })).resolves.toEqual({
      request: { Filters: [] },
    });
    await expect(
      authority.api.describeInstanceAttribute({
        InstanceId: 'i-safe',
        Attribute: 'disableApiStop',
      }),
    ).resolves.toEqual({
      request: {
        InstanceId: 'i-safe',
        Attribute: 'disableApiStop',
      },
    });
    await expect(
      authority.api.describeInstanceCreditSpecifications({
        Filters: [{ Name: 'instance-id', Values: ['i-safe'] }],
      }),
    ).resolves.toEqual({
      request: {
        Filters: [{ Name: 'instance-id', Values: ['i-safe'] }],
      },
    });
    await expect(
      authority.api.describeNetworkAcls({
        Filters: [{ Name: 'association.subnet-id', Values: ['subnet-safe'] }],
      }),
    ).resolves.toEqual({
      request: {
        Filters: [{ Name: 'association.subnet-id', Values: ['subnet-safe'] }],
      },
    });
    await expect(authority.resolveScope()).resolves.toEqual(
      authority.providerScope,
    );
    expect(harness.dependencies.resolveCredentials).toHaveBeenCalledWith({
      region: REGION,
    });
    expect(harness.dependencies.createEc2Client).toHaveBeenCalledTimes(1);
    const stsCreationInput =
      harness.dependencies.createStsClient.mock.calls[0][0];
    const ec2CreationInput =
      harness.dependencies.createEc2Client.mock.calls[0][0];
    expect(ec2CreationInput.region).toBe(REGION);
    expect(typeof ec2CreationInput.credentials).toBe('function');
    expect(stsCreationInput.credentials).toBe(ec2CreationInput.credentials);
    const credentialSnapshot = await ec2CreationInput.credentials();
    expect(credentialSnapshot).toMatchObject({
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret-credential-sentinel',
      sessionToken: 'session-credential-sentinel',
    });
    expect(Object.isFrozen(credentialSnapshot)).toBe(true);
    await expect(stsCreationInput.credentials()).resolves.toBe(
      credentialSnapshot,
    );
    expect(authority.credentials).toBeUndefined();
    expect(JSON.stringify(authority)).not.toContain('credential-sentinel');

    await authority.close();
    await authority.close();
    expect(harness.ec2.close).toHaveBeenCalledTimes(1);
    expect(harness.sts.close).toHaveBeenCalledTimes(1);
    await expect(authority.api.describeVpcs({ Filters: [] })).rejects.toThrow(
      /closed/iu,
    );
  });

  it('sanitizes SDK read failures without retaining their cause', async () => {
    const sentinel = 'raw-sdk-secret-sentinel';
    const harness = makeHarness();
    harness.ec2.describeVpcs.mockRejectedValueOnce(new Error(sentinel));
    const authority = await harness.open({ region: REGION });

    let thrown;
    try {
      await authority.api.describeVpcs({ Filters: [] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AwsSingleNodeReadError);
    expect(String(thrown)).not.toContain(sentinel);
    expect(/** @type {Error & {cause?: unknown}} */ (thrown).cause).toBe(
      undefined,
    );
    await authority.close();
  });

  it('fails closed when STS identity changes during the invocation', async () => {
    const harness = makeHarness();
    harness.sts.getCallerIdentity
      .mockResolvedValueOnce(identity())
      .mockResolvedValueOnce(identity('999999999999'));
    const authority = await harness.open({ region: REGION });

    await expect(authority.resolveScope()).rejects.toBeInstanceOf(
      AwsSingleNodeScopeResolutionError,
    );
    await authority.close();
  });

  it('closes already-owned clients after a later construction failure', async () => {
    const sentinel = 'client-construction-secret-sentinel';
    const harness = makeHarness({
      createEc2Client: jest.fn(async () => {
        throw new Error(sentinel);
      }),
    });

    let thrown;
    try {
      await harness.open({ region: REGION });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AwsSingleNodeAuthorityInitializationError);
    expect(String(thrown)).not.toContain(sentinel);
    expect(harness.sts.close).toHaveBeenCalledTimes(1);
  });

  it('rejects credential-like public options without echoing their value', async () => {
    const sentinel = 'public-secret-option-sentinel';
    const harness = makeHarness();
    let thrown;
    try {
      await harness.open({ region: REGION, accessKeyId: sentinel });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(String(thrown)).not.toContain(sentinel);
    expect(harness.dependencies.resolveCredentials).not.toHaveBeenCalled();
  });
});
