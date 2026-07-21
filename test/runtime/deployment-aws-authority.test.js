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
const S3_CONTROL_METHODS = Object.freeze([
  'createBucket',
  'headBucket',
  'getBucketEncryption',
  'getBucketLifecycleConfiguration',
  'getBucketLocation',
  'getBucketOwnershipControls',
  'getBucketPolicy',
  'getBucketReplication',
  'getBucketTagging',
  'getBucketVersioning',
  'getPublicAccessBlock',
  'putBucketEncryption',
  'putBucketOwnershipControls',
  'putBucketVersioning',
  'putPublicAccessBlock',
  'putObject',
  'headObject',
]);

/**
 * Install isolated AWS SDK doubles before importing the authority module.
 * @param {{credentials?: unknown, identities?: unknown[], s3ConstructionError?: unknown, s3MethodError?: unknown, s3CloseError?: unknown}} [options] - Mock outcomes.
 * @returns {Promise<Record<string, any>>} - Module and SDK observations.
 */
async function loadHarness({
  credentials = CREDENTIALS,
  identities = [],
  s3ConstructionError,
  s3MethodError,
  s3CloseError,
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
  /** @type {Record<string, any>[]} */
  const s3Configs = [];
  const stsDestroy = jest.fn();
  const dynamoDestroy = jest.fn();
  const dynamoSend = jest.fn(
    async (
      /** @type {string} */ _method,
      /** @type {unknown} */ _input,
    ) => ({}),
  );
  const documentDestroy = jest.fn();
  const s3Destroy = jest.fn(() => {
    if (s3CloseError) throw s3CloseError;
  });
  const s3Send = jest.fn(
    async (/** @type {string} */ _method, /** @type {unknown} */ _input) => {
      if (s3MethodError) throw s3MethodError;
      return {};
    },
  );
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
  jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
    S3: class S3 {
      constructor(/** @type {Record<string, any>} */ config) {
        if (s3ConstructionError) throw s3ConstructionError;
        s3Configs.push(config);
        for (const method of S3_CONTROL_METHODS) {
          /** @type {Record<string, any>} */ (this)[method] = (
            /** @type {unknown} */ input,
          ) => s3Send(method, input);
        }
      }

      destroy() {
        s3Destroy();
      }
    },
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
    s3Configs,
    stsSend,
    stsDestroy,
    dynamoDestroy,
    dynamoSend,
    documentDestroy,
    s3Destroy,
    s3Send,
  };
}

describe('AWS deployment invocation authority', () => {
  it('pins explicit region and one credential snapshot across STS, DynamoDB, and S3', async () => {
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
      const s3ControlClient = authority.createS3ControlClient();
      expect(harness.dynamoConfigs[0].region).toBe('us-east-1');
      expect(harness.dynamoConfigs[0].credentials).toBe(credentials);
      expect(harness.dynamoConfigs[1].region).toBe('us-east-1');
      expect(harness.dynamoConfigs[1].credentials).toBe(credentials);
      expect(harness.s3Configs[0].region).toBe('us-east-1');
      expect(harness.s3Configs[0].credentials).toBe(credentials);
      expect(Object.isFrozen(controlClient)).toBe(true);
      expect(Object.isFrozen(s3ControlClient)).toBe(true);
      expect(controlClient).not.toHaveProperty('config');
      expect(s3ControlClient).not.toHaveProperty('config');
      await controlClient.describeTable({ TableName: 'control-table' });
      expect(harness.dynamoSend).toHaveBeenCalledWith('describeTable', {
        TableName: 'control-table',
      });
      await s3ControlClient.headBucket({ Bucket: 'control-bucket' });
      expect(harness.s3Send).toHaveBeenCalledWith('headBucket', {
        Bucket: 'control-bucket',
      });
      await expect(authority.resolveScope()).resolves.toEqual(
        authority.providerScope,
      );
      expect(harness.stsSend).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(authority)).not.toMatch(/AKIA|never-print/);
      await db.close();
      await controlClient.close();
      await s3ControlClient.close();
      await authority.close();
    } finally {
      if (previousRegion === undefined) delete process.env.AWS_REGION;
      else process.env.AWS_REGION = previousRegion;
    }
  });

  it('exposes only the exact narrow S3 control surface', async () => {
    const harness = await loadHarness();
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    const client = /** @type {Record<string, any>} */ (
      authority.createS3ControlClient()
    );
    try {
      expect(Object.keys(client).sort()).toEqual(
        [...S3_CONTROL_METHODS, 'close'].sort(),
      );
      expect(client).not.toHaveProperty('config');
      expect(client).not.toHaveProperty('credentials');
      expect(client).not.toHaveProperty('destroy');
      expect(client).not.toHaveProperty('send');
      expect(JSON.stringify(client)).not.toMatch(/AKIA|never-print/);

      for (const method of S3_CONTROL_METHODS) {
        const input = { operationMarker: method };
        await expect(client[method](input)).resolves.toEqual({});
        expect(harness.s3Send).toHaveBeenLastCalledWith(method, input);
      }
    } finally {
      await client.close();
      await authority.close();
    }
  });

  it('normalizes S3 failures while preserving only allowlisted operation identity', async () => {
    const constructionHarness = await loadHarness({
      s3ConstructionError: new Error('construction-secret'),
    });
    const constructionAuthority =
      await constructionHarness.createAwsDeploymentAuthority({
        region: 'us-east-1',
      });
    expect(() => constructionAuthority.createS3ControlClient()).toThrow(
      'AWS deployment S3 control client creation failed.',
    );
    await constructionAuthority.close();

    const operationError = new Error('provider detail');
    operationError.name = 'NoSuchBucketPolicy';
    /** @type {any} */ (operationError).$metadata = {
      httpStatusCode: 404,
      requestId: 'provider-request-secret',
    };
    const operationHarness = await loadHarness({
      s3MethodError: operationError,
      s3CloseError: new Error('close-secret'),
    });
    const operationAuthority =
      await operationHarness.createAwsDeploymentAuthority({
        region: 'us-east-1',
      });
    const client = operationAuthority.createS3ControlClient();

    const observed = await client
      .getBucketPolicy({
        Bucket: 'control',
        ExpectedBucketOwner: IDENTITY.Account,
      })
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).not.toBe(operationError);
    expect(observed).toMatchObject({
      name: 'NoSuchBucketPolicy',
      code: 'AWS_DEPLOYMENT_S3_CONTROL_OPERATION',
      message: 'AWS deployment S3 control operation failed.',
      $metadata: { httpStatusCode: 404 },
    });
    expect(JSON.stringify(observed)).not.toMatch(
      /provider detail|provider-request-secret/,
    );
    const firstClose = client.close();
    expect(client.close()).toBe(firstClose);
    await expect(firstClose).rejects.toThrow(
      'AWS deployment S3 control client close failed.',
    );
    expect(operationHarness.s3Destroy).toHaveBeenCalledTimes(1);
    await expect(
      client.headObject({ Bucket: 'control', Key: 'stage' }),
    ).rejects.toThrow('AWS deployment S3 control client is closed.');
    await operationAuthority.close();
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

  it('closes STS idempotently, leaves issued DB and S3 ownership to callers, and refuses reuse', async () => {
    const harness = await loadHarness();
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    const db = authority.createDynamoDB();
    const controlClient = authority.createDynamoDBControlClient();
    const s3ControlClient = /** @type {Record<string, any>} */ (
      authority.createS3ControlClient()
    );

    await authority.close();
    await authority.close();
    expect(harness.stsDestroy).toHaveBeenCalledTimes(1);
    expect(harness.documentDestroy).not.toHaveBeenCalled();
    expect(harness.dynamoDestroy).not.toHaveBeenCalled();
    expect(harness.s3Destroy).not.toHaveBeenCalled();
    await expect(authority.resolveScope()).rejects.toThrow(
      'AWS deployment authority is closed.',
    );
    expect(() => authority.createDynamoDB()).toThrow(
      'AWS deployment authority is closed.',
    );
    expect(() => authority.createDynamoDBControlClient()).toThrow(
      'AWS deployment authority is closed.',
    );
    expect(() => authority.createS3ControlClient()).toThrow(
      'AWS deployment authority is closed.',
    );
    await expect(
      s3ControlClient.headBucket({ Bucket: 'still-caller-owned' }),
    ).resolves.toEqual({});

    await db.close();
    await controlClient.close();
    await controlClient.close();
    expect(() =>
      controlClient.describeTable({ TableName: 'not-contacted' }),
    ).toThrow('AWS deployment DynamoDB control client is closed.');
    const firstS3Close = s3ControlClient.close();
    expect(s3ControlClient.close()).toBe(firstS3Close);
    await firstS3Close;
    for (const method of S3_CONTROL_METHODS) {
      await expect(s3ControlClient[method]({})).rejects.toThrow(
        'AWS deployment S3 control client is closed.',
      );
    }
    expect(harness.documentDestroy).toHaveBeenCalledTimes(1);
    expect(harness.dynamoDestroy).toHaveBeenCalledTimes(1);
    expect(harness.s3Destroy).toHaveBeenCalledTimes(1);
  });
});
