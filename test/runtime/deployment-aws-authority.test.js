import { describe, expect, it, jest } from '@jest/globals';

const AUTHORITY_IMPORT = '../../src/core/runtime/deployment-aws-authority.js';

const CREDENTIALS = Object.freeze({
  accessKeyId: 'AKIAEXAMPLE00000001',
  secretAccessKey: 'never-print-this-secret',
  sessionToken: 'never-print-this-token',
  accountId: '123456789012',
  credentialScope: 'ignored-provider-metadata',
});
const IDENTITY = Object.freeze({
  Account: '123456789012',
  Arn: 'arn:aws:sts::123456789012:assumed-role/wharfie/test-session',
  UserId: 'AROATEST:test-session',
});

/**
 * Install isolated AWS SDK doubles before importing the authority module.
 * @param {{credentials?: unknown, identities?: unknown[]}} [options] - Mock outcomes.
 * @returns {Promise<Record<string, any>>} - Module and SDK observations.
 */
async function loadHarness({
  credentials = CREDENTIALS,
  identities = [],
} = {}) {
  jest.resetModules();
  const credentialProvider = jest.fn(async () => {
    if (credentials instanceof Error) throw credentials;
    return credentials;
  });
  const fromNodeProviderChain = jest.fn(() => credentialProvider);
  /** @type {Record<string, any>[]} */
  const stsConfigs = [];
  /** @type {Record<string, any>[]} */
  const dynamoConfigs = [];
  const stsDestroy = jest.fn();
  const dynamoDestroy = jest.fn();
  const dynamoSend = jest.fn(
    async (
      /** @type {string} */ _method,
      /** @type {unknown} */ _input,
    ) => ({}),
  );
  const documentDestroy = jest.fn();
  const responses = [...identities];
  const stsSend = jest.fn(async (/** @type {unknown} */ _command) => {
    const response = responses.length > 0 ? responses.shift() : IDENTITY;
    if (response instanceof Error) throw response;
    return response;
  });

  jest.unstable_mockModule('@aws-sdk/credential-providers', () => ({
    fromNodeProviderChain,
  }));
  jest.unstable_mockModule('@aws-sdk/client-sts', () => ({
    GetCallerIdentityCommand: class GetCallerIdentityCommand {
      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    STSClient: class STSClient {
      constructor(/** @type {Record<string, any>} */ config) {
        stsConfigs.push(config);
      }

      send(/** @type {unknown} */ command) {
        return stsSend(command);
      }

      destroy() {
        stsDestroy();
      }
    },
  }));
  jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
    DynamoDB: class DynamoDB {
      constructor(/** @type {Record<string, any>} */ config) {
        dynamoConfigs.push(config);
      }

      createTable(/** @type {unknown} */ input) {
        return dynamoSend('createTable', input);
      }

      describeContinuousBackups(/** @type {unknown} */ input) {
        return dynamoSend('describeContinuousBackups', input);
      }

      describeTable(/** @type {unknown} */ input) {
        return dynamoSend('describeTable', input);
      }

      describeTimeToLive(/** @type {unknown} */ input) {
        return dynamoSend('describeTimeToLive', input);
      }

      listTagsOfResource(/** @type {unknown} */ input) {
        return dynamoSend('listTagsOfResource', input);
      }

      updateContinuousBackups(/** @type {unknown} */ input) {
        return dynamoSend('updateContinuousBackups', input);
      }

      destroy() {
        dynamoDestroy();
      }
    },
    ProvisionedThroughputExceededException: class extends Error {},
    ResourceNotFoundException: class extends Error {},
    ReturnValue: { NONE: 'NONE' },
  }));
  const documentClient = {
    query: jest.fn(),
    put: jest.fn(),
    update: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    batchWrite: jest.fn(),
    transactWrite: jest.fn(),
    destroy: documentDestroy,
  };
  jest.unstable_mockModule('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocument: { from: jest.fn(() => documentClient) },
  }));

  const authorityModule = await import(AUTHORITY_IMPORT);
  return {
    ...authorityModule,
    credentialProvider,
    fromNodeProviderChain,
    stsConfigs,
    dynamoConfigs,
    stsSend,
    stsDestroy,
    dynamoDestroy,
    dynamoSend,
    documentDestroy,
  };
}

describe('AWS deployment invocation authority', () => {
  it('pins explicit region and one credential snapshot across STS and DynamoDB', async () => {
    const previousRegion = process.env.AWS_REGION;
    process.env.AWS_REGION = 'eu-west-1';
    const harness = await loadHarness();
    try {
      const authority = await harness.createAwsDeploymentAuthority({
        region: 'us-east-1',
      });
      const credentials = harness.stsConfigs[0].credentials;
      expect(authority.providerScope).toMatchObject({
        provider: 'aws',
        partition: 'aws',
        accountId: '123456789012',
        region: 'us-east-1',
      });
      expect(harness.fromNodeProviderChain).toHaveBeenCalledTimes(1);
      expect(harness.fromNodeProviderChain).toHaveBeenCalledWith({
        clientConfig: { region: 'us-east-1' },
      });
      expect(harness.credentialProvider).toHaveBeenCalledTimes(1);
      expect(credentials).not.toBe(CREDENTIALS);
      expect(Object.isFrozen(credentials)).toBe(true);
      expect(credentials).not.toHaveProperty('accountId');
      expect(credentials).not.toHaveProperty('credentialScope');
      expect(harness.stsConfigs[0].region).toBe('us-east-1');

      const db = authority.createDynamoDB({ readOnly: true });
      const controlClient = authority.createDynamoDBControlClient();
      expect(harness.dynamoConfigs[0].region).toBe('us-east-1');
      expect(harness.dynamoConfigs[0].credentials).toBe(credentials);
      expect(harness.dynamoConfigs[1].region).toBe('us-east-1');
      expect(harness.dynamoConfigs[1].credentials).toBe(credentials);
      expect(Object.isFrozen(controlClient)).toBe(true);
      expect(controlClient).not.toHaveProperty('config');
      await controlClient.describeTable({ TableName: 'control-table' });
      expect(harness.dynamoSend).toHaveBeenCalledWith('describeTable', {
        TableName: 'control-table',
      });
      await expect(authority.resolveScope()).resolves.toEqual(
        authority.providerScope,
      );
      expect(harness.stsSend).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(authority)).not.toMatch(/AKIA|never-print/);
      await db.close();
      await controlClient.close();
      await authority.close();
    } finally {
      if (previousRegion === undefined) delete process.env.AWS_REGION;
      else process.env.AWS_REGION = previousRegion;
    }
  });

  it.each([
    [
      { Account: 'not-an-account', Arn: IDENTITY.Arn },
      'AWS caller identity response is invalid.',
    ],
    [
      { Account: IDENTITY.Account, Arn: 'arn:malformed:do-not-echo' },
      'AWS caller identity response is invalid.',
    ],
    [
      {
        Account: IDENTITY.Account,
        Arn: 'arn:aws:sts::999999999999:assumed-role/wrong/account',
      },
      'AWS caller identity response is internally inconsistent.',
    ],
  ])(
    'fails closed on malformed or mismatched caller identity',
    async (identity, message) => {
      const harness = await loadHarness({ identities: [identity] });
      await expect(
        harness.createAwsDeploymentAuthority({ region: 'us-east-1' }),
      ).rejects.toThrow(message);
      expect(harness.stsDestroy).toHaveBeenCalledTimes(1);
    },
  );

  it('fails closed if a later caller identity no longer matches the invocation scope', async () => {
    const harness = await loadHarness({
      identities: [
        IDENTITY,
        {
          Account: '999999999999',
          Arn: 'arn:aws:sts::999999999999:assumed-role/wharfie/changed',
        },
      ],
    });
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });

    await expect(authority.resolveScope()).rejects.toThrow(
      'AWS caller identity changed during the deployment invocation.',
    );
    await authority.close();
  });

  it('requires an explicit canonical region and never falls back to ambient region', async () => {
    const previousRegion = process.env.AWS_REGION;
    process.env.AWS_REGION = 'us-west-2';
    const harness = await loadHarness();
    try {
      await expect(harness.createAwsDeploymentAuthority()).rejects.toThrow(
        'AWS deployment authority options must contain only one explicit region.',
      );
      await expect(
        harness.createAwsDeploymentAuthority({ region: 'NOT-CANONICAL' }),
      ).rejects.toThrow('AWS deployment authority region must be canonical.');
      expect(harness.fromNodeProviderChain).not.toHaveBeenCalled();
    } finally {
      if (previousRegion === undefined) delete process.env.AWS_REGION;
      else process.env.AWS_REGION = previousRegion;
    }
  });

  it('replaces credential-provider failures with a fixed non-echoing error', async () => {
    const providerError = Object.assign(
      new Error(
        'AWS deployment credential resolution returned an invalid identity.',
      ),
      { providerSecret: 'never-echo-this-provider-secret' },
    );
    const harness = await loadHarness({ credentials: providerError });

    await expect(
      harness.createAwsDeploymentAuthority({ region: 'us-east-1' }),
    ).rejects.toThrow('AWS deployment credential resolution failed.');
  });

  it('rejects malformed resolved credentials with a fixed non-echoing error', async () => {
    const harness = await loadHarness({
      credentials: {
        accessKeyId: 'AKIAINVALID',
        secretAccessKey: '',
        leakedDetail: 'never-echo-this-field',
      },
    });

    await expect(
      harness.createAwsDeploymentAuthority({ region: 'us-east-1' }),
    ).rejects.toThrow(
      'AWS deployment credential resolution returned an invalid identity.',
    );
  });

  it('closes STS idempotently, leaves issued DB ownership to the caller, and refuses reuse', async () => {
    const harness = await loadHarness();
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    const db = authority.createDynamoDB();
    const controlClient = authority.createDynamoDBControlClient();

    await authority.close();
    await authority.close();
    expect(harness.stsDestroy).toHaveBeenCalledTimes(1);
    expect(harness.documentDestroy).not.toHaveBeenCalled();
    expect(harness.dynamoDestroy).not.toHaveBeenCalled();
    await expect(authority.resolveScope()).rejects.toThrow(
      'AWS deployment authority is closed.',
    );
    expect(() => authority.createDynamoDB()).toThrow(
      'AWS deployment authority is closed.',
    );
    expect(() => authority.createDynamoDBControlClient()).toThrow(
      'AWS deployment authority is closed.',
    );

    await db.close();
    await controlClient.close();
    await controlClient.close();
    expect(() =>
      controlClient.describeTable({ TableName: 'not-contacted' }),
    ).toThrow('AWS deployment DynamoDB control client is closed.');
    expect(harness.documentDestroy).toHaveBeenCalledTimes(1);
    expect(harness.dynamoDestroy).toHaveBeenCalledTimes(1);
  });
});
