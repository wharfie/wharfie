import { describe, expect, it, jest } from '@jest/globals';

import {
  AWS_SINGLE_NODE_OPERATION_MAX_ATTEMPTS,
  AwsSingleNodeOperationAuthorityCloseError,
  AwsSingleNodeOperationAuthorityClosedError,
  AwsSingleNodeOperationAuthorityInitializationError,
  AwsSingleNodeOperationMutationError,
  AwsSingleNodeOperationReadError,
  AwsSingleNodeOperationScopeChangedError,
  AwsSingleNodeOperationScopeResolutionError,
  createAwsSingleNodeOperationAuthorityFactory,
} from '../../../../src/core/runtime/providers/aws/operation-authority.js';

const REGION = 'us-east-2';
const ACCOUNT_ID = '123456789012';
const READ_METHODS = Object.freeze([
  'describeSecurityGroups',
  'describeInstanceAttribute',
  'describeInstanceCreditSpecifications',
  'describeInstances',
  'describeVolumes',
]);
const MUTATION_METHODS = Object.freeze([
  'createSecurityGroup',
  'authorizeSecurityGroupIngress',
  'runInstances',
  'terminateInstances',
  'deleteVolume',
  'deleteSecurityGroup',
]);
const API_METHODS = Object.freeze([...READ_METHODS, ...MUTATION_METHODS]);

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
  const credentialProvider = jest.fn(async () => ({
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'secret-credential-sentinel',
    sessionToken: 'session-credential-sentinel',
  }));
  const sts = {
    getCallerIdentity: jest.fn(async () => identity()),
    close: jest.fn(async () => {}),
  };
  /** @type {Record<string, jest.Mock>} */
  const ec2 = {
    close: jest.fn(async () => {}),
  };
  for (const method of API_METHODS) {
    ec2[method] = jest.fn(async (request) => ({ method, request }));
  }
  const dependencies = {
    createCredentialProvider: jest.fn(() => credentialProvider),
    createStsClient: jest.fn(async () => sts),
    createEc2Client: jest.fn(async () => ec2),
    ...overrides,
  };
  return {
    credentialProvider,
    sts,
    ec2,
    dependencies,
    open: createAwsSingleNodeOperationAuthorityFactory(dependencies),
  };
}

describe('AWS single-node operation authority', () => {
  it('shares one unresolved credential provider and exposes only the narrow API', async () => {
    const harness = makeHarness();
    const authority = await harness.open({ region: REGION });

    expect(authority).toMatchObject({
      schemaVersion: 1,
      kind: 'awsSingleNodeOperationAuthority',
      providerScope: {
        provider: 'aws',
        partition: 'aws',
        accountId: ACCOUNT_ID,
        region: REGION,
        providerScopeId: expect.stringMatching(/^wps1_[A-Za-z0-9_-]{43}$/u),
      },
    });
    expect(Object.keys(authority.api).sort()).toEqual([...API_METHODS].sort());
    expect(authority.api.describeVpcs).toBeUndefined();
    expect(authority.api.createVpc).toBeUndefined();
    expect(authority.credentials).toBeUndefined();

    expect(harness.dependencies.createCredentialProvider).toHaveBeenCalledWith({
      region: REGION,
    });
    expect(harness.dependencies.createCredentialProvider).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.credentialProvider).not.toHaveBeenCalled();
    const stsInput = harness.dependencies.createStsClient.mock.calls[0][0];
    const ec2Input = harness.dependencies.createEc2Client.mock.calls[0][0];
    expect(stsInput.credentials).toBe(harness.credentialProvider);
    expect(ec2Input.credentials).toBe(harness.credentialProvider);
    expect(ec2Input).toEqual({
      region: REGION,
      credentials: harness.credentialProvider,
      maxAttempts: AWS_SINGLE_NODE_OPERATION_MAX_ATTEMPTS,
    });
    expect(AWS_SINGLE_NODE_OPERATION_MAX_ATTEMPTS).toBe(1);
    expect(JSON.stringify(authority)).not.toContain('credential-sentinel');

    await authority.close();
  });

  it('forwards reads without granting the method a sibling-capability receiver', async () => {
    /** @type {unknown} */
    let observedReceiver = Symbol('not-called');
    const harness = makeHarness();
    harness.ec2.describeInstanceAttribute = jest.fn(
      /**
       * @this {undefined}
       * @param {unknown} request
       * @returns {{request: unknown}}
       */
      function (request) {
        observedReceiver = this;
        return { request };
      },
    );
    const authority = await harness.open({ region: REGION });
    const request = {
      InstanceId: 'i-0123456789abcdef0',
      Attribute: 'disableApiTermination',
    };

    await expect(
      authority.api.describeInstanceAttribute(request),
    ).resolves.toEqual({ request });
    expect(observedReceiver).toBeUndefined();
    expect(harness.sts.getCallerIdentity).toHaveBeenCalledTimes(1);

    await authority.close();
  });

  it('re-checks the bound STS scope before every mutation', async () => {
    const harness = makeHarness();
    const authority = await harness.open({ region: REGION });

    for (const method of MUTATION_METHODS) {
      const request = { marker: method };
      await expect(authority.api[method](request)).resolves.toEqual({
        method,
        request,
      });
      expect(harness.ec2[method]).toHaveBeenCalledWith(request);
    }
    expect(harness.sts.getCallerIdentity).toHaveBeenCalledTimes(
      1 + MUTATION_METHODS.length,
    );

    await authority.close();
  });

  it('blocks a mutation before EC2 when refreshed credentials change scope', async () => {
    const harness = makeHarness();
    harness.sts.getCallerIdentity
      .mockResolvedValueOnce(identity())
      .mockResolvedValueOnce(identity('999999999999'));
    const authority = await harness.open({ region: REGION });

    await expect(
      authority.api.createSecurityGroup({
        GroupName: 'must-not-run',
        Description: 'must-not-run',
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodeOperationScopeChangedError);
    expect(harness.ec2.createSecurityGroup).not.toHaveBeenCalled();

    await authority.close();
  });

  it('resolves only the original secret-free scope and sanitizes STS failures', async () => {
    const sentinel = 'raw-sts-secret-sentinel';
    const harness = makeHarness();
    const authority = await harness.open({ region: REGION });

    await expect(authority.resolveScope()).resolves.toEqual(
      authority.providerScope,
    );
    harness.sts.getCallerIdentity.mockRejectedValueOnce(new Error(sentinel));
    let thrown;
    try {
      await authority.resolveScope();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AwsSingleNodeOperationScopeResolutionError);
    expect(String(thrown)).not.toContain(sentinel);
    expect(/** @type {Error & {cause?: unknown}} */ (thrown).cause).toBe(
      undefined,
    );

    await authority.close();
  });

  it('sanitizes read and mutation SDK failures without retaining causes', async () => {
    const sentinel = 'raw-ec2-secret-sentinel';
    const harness = makeHarness();
    harness.ec2.describeVolumes.mockRejectedValueOnce(new Error(sentinel));
    harness.ec2.runInstances.mockRejectedValueOnce(new Error(sentinel));
    const authority = await harness.open({ region: REGION });

    /** @type {unknown[]} */
    const failures = [];
    for (const invoke of [
      async () => await authority.api.describeVolumes({}),
      async () => await authority.api.runInstances({}),
    ]) {
      try {
        await invoke();
      } catch (error) {
        failures.push(error);
      }
    }
    expect(failures[0]).toBeInstanceOf(AwsSingleNodeOperationReadError);
    expect(failures[1]).toBeInstanceOf(AwsSingleNodeOperationMutationError);
    for (const failure of failures) {
      expect(String(failure)).not.toContain(sentinel);
      expect(
        /** @type {Error & {cause?: unknown}} */ (failure).cause,
      ).toBeUndefined();
    }

    await authority.close();
  });

  it('closes clients once in reverse construction order and stays closed', async () => {
    const harness = makeHarness();
    const authority = await harness.open({ region: REGION });

    const first = authority.close();
    const second = authority.close();
    expect(second).toBe(first);
    await first;
    expect(harness.ec2.close).toHaveBeenCalledTimes(1);
    expect(harness.sts.close).toHaveBeenCalledTimes(1);
    expect(harness.ec2.close.mock.invocationCallOrder[0]).toBeLessThan(
      harness.sts.close.mock.invocationCallOrder[0],
    );
    await expect(authority.api.describeVolumes({})).rejects.toBeInstanceOf(
      AwsSingleNodeOperationAuthorityClosedError,
    );
    await expect(authority.api.deleteVolume({})).rejects.toBeInstanceOf(
      AwsSingleNodeOperationAuthorityClosedError,
    );
    await expect(authority.resolveScope()).rejects.toBeInstanceOf(
      AwsSingleNodeOperationAuthorityClosedError,
    );
  });

  it('closes all clients and returns one fixed close failure', async () => {
    const sentinel = 'raw-close-secret-sentinel';
    const harness = makeHarness();
    harness.ec2.close.mockRejectedValueOnce(new Error(sentinel));
    harness.sts.close.mockRejectedValueOnce(new Error(sentinel));
    const authority = await harness.open({ region: REGION });

    let thrown;
    try {
      await authority.close();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AwsSingleNodeOperationAuthorityCloseError);
    expect(String(thrown)).not.toContain(sentinel);
    expect(harness.ec2.close).toHaveBeenCalledTimes(1);
    expect(harness.sts.close).toHaveBeenCalledTimes(1);
    await expect(authority.close()).rejects.toBe(thrown);
  });

  it('cleans up a constructed STS client after later initialization failure', async () => {
    const sentinel = 'raw-construction-secret-sentinel';
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
    expect(thrown).toBeInstanceOf(
      AwsSingleNodeOperationAuthorityInitializationError,
    );
    expect(String(thrown)).not.toContain(sentinel);
    expect(/** @type {Error & {cause?: unknown}} */ (thrown).cause).toBe(
      undefined,
    );
    expect(harness.sts.close).toHaveBeenCalledTimes(1);
  });

  it('rejects inexact options, dependencies, and client ports', async () => {
    const secret = 'forbidden-public-secret-sentinel';
    const harness = makeHarness();
    await expect(
      harness.open({ region: REGION, secretAccessKey: secret }),
    ).rejects.toThrow('fields are invalid');
    expect(
      harness.dependencies.createCredentialProvider,
    ).not.toHaveBeenCalled();

    expect(() =>
      createAwsSingleNodeOperationAuthorityFactory({
        ...harness.dependencies,
        extraCapability: () => {},
      }),
    ).toThrow('fields are invalid');

    const accessorDependencies = { ...harness.dependencies };
    Object.defineProperty(accessorDependencies, 'createEc2Client', {
      enumerable: true,
      get() {
        throw new Error(secret);
      },
    });
    expect(() =>
      createAwsSingleNodeOperationAuthorityFactory(accessorDependencies),
    ).toThrow('must be an own data field');

    const invalidClientHarness = makeHarness({
      createEc2Client: jest.fn(async () => ({
        ...harness.ec2,
        createVpc: jest.fn(),
      })),
    });
    await expect(
      invalidClientHarness.open({ region: REGION }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeOperationAuthorityInitializationError,
    );
    expect(invalidClientHarness.credentialProvider).not.toHaveBeenCalled();
  });
});
