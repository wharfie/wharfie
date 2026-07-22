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
  'getObject',
  'putBucketEncryption',
  'putBucketLifecycleConfiguration',
  'putBucketOwnershipControls',
  'putBucketVersioning',
  'putPublicAccessBlock',
  'putObject',
  'headObject',
]);
const PROVIDER_SPEC_READ_METHODS = Object.freeze([
  'getParameter',
  'describeAvailabilityZones',
  'describeImages',
  'describeInstanceTypeOfferings',
  'getEbsDefaultKmsKeyId',
]);
const VOLUME_RESOURCE_METHODS = Object.freeze([
  'createVolume',
  'describeVolumes',
]);
const NETWORK_RESOURCE_METHODS = Object.freeze([
  'associateRouteTable',
  'attachInternetGateway',
  'createInternetGateway',
  'createRoute',
  'createRouteTable',
  'createSecurityGroup',
  'createSubnet',
  'createVpc',
  'describeInternetGateways',
  'describeRouteTables',
  'describeSecurityGroups',
  'describeSubnets',
  'describeVpcs',
  'describeVpcAttribute',
  'disassociateRouteTable',
  'detachInternetGateway',
  'deleteInternetGateway',
  'deleteRoute',
  'deleteRouteTable',
  'deleteSecurityGroup',
  'deleteSubnet',
  'deleteVpc',
]);
const RUNTIME_IDENTITY_RESOURCE_METHODS = Object.freeze([
  'createRole',
  'getRole',
  'deleteRole',
  'listRoleTags',
  'listRolePolicies',
  'listAttachedRolePolicies',
  'putRolePolicy',
  'getRolePolicy',
  'deleteRolePolicy',
  'createInstanceProfile',
  'getInstanceProfile',
  'deleteInstanceProfile',
  'listInstanceProfileTags',
  'addRoleToInstanceProfile',
  'removeRoleFromInstanceProfile',
  'listInstanceProfilesForRole',
  'describeInstances',
]);

/**
 * Install isolated AWS SDK doubles before importing the authority module.
 * @param {{credentials?: unknown, identities?: unknown[], s3ConstructionError?: unknown, s3MethodError?: unknown, s3CloseError?: unknown, ssmConstructionError?: unknown, ec2ConstructionError?: unknown, iamConstructionError?: unknown, ssmMethodError?: unknown, ec2MethodError?: unknown, iamMethodError?: unknown, ssmCloseError?: unknown, ec2CloseError?: unknown, iamCloseError?: unknown}} [options] - Mock outcomes.
 * @returns {Promise<Record<string, any>>} - Module and SDK observations.
 */
async function loadHarness({
  credentials = CREDENTIALS,
  identities = [],
  s3ConstructionError,
  s3MethodError,
  s3CloseError,
  ssmConstructionError,
  ec2ConstructionError,
  iamConstructionError,
  ssmMethodError,
  ec2MethodError,
  iamMethodError,
  ssmCloseError,
  ec2CloseError,
  iamCloseError,
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
  /** @type {Record<string, any>[]} */
  const ssmConfigs = [];
  /** @type {Record<string, any>[]} */
  const ec2Configs = [];
  /** @type {Record<string, any>[]} */
  const iamConfigs = [];
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
  const ssmDestroy = jest.fn(() => {
    if (ssmCloseError) throw ssmCloseError;
  });
  const ec2Destroy = jest.fn(() => {
    if (ec2CloseError) throw ec2CloseError;
  });
  const iamDestroy = jest.fn(() => {
    if (iamCloseError) throw iamCloseError;
  });
  const ssmSend = jest.fn(async (/** @type {unknown} */ input) => {
    if (ssmMethodError) throw ssmMethodError;
    return { Parameter: { Value: 'resolved-parameter' }, input };
  });
  const ec2Send = jest.fn(
    async (/** @type {string} */ method, /** @type {unknown} */ input) => {
      if (ec2MethodError) throw ec2MethodError;
      if (method === 'describeAvailabilityZones') {
        return { AvailabilityZones: [], input };
      }
      if (method === 'describeImages') return { Images: [], input };
      if (method === 'describeInstanceTypeOfferings') {
        return { InstanceTypeOfferings: [], input };
      }
      if (method === 'getEbsDefaultKmsKeyId') {
        return {
          KmsKeyId:
            'arn:aws:kms:us-east-1:123456789012:key/00000000-0000-4000-8000-000000000001',
          input,
        };
      }
      if (method === 'createVolume') {
        return { VolumeId: 'vol-00000000000000001', input };
      }
      if (method === 'describeVolumes') return { Volumes: [], input };
      if (method === 'describeInstances') return { Reservations: [], input };
      if (method === 'createInternetGateway') {
        return {
          InternetGateway: {
            InternetGatewayId: 'igw-00000000000000001',
          },
          input,
        };
      }
      if (method === 'createRoute') return { Return: true, input };
      if (method === 'createRouteTable') {
        return {
          RouteTable: { RouteTableId: 'rtb-00000000000000001' },
          input,
        };
      }
      if (method === 'createSecurityGroup') {
        return { GroupId: 'sg-00000000000000001', input };
      }
      if (method === 'createSubnet') {
        return { Subnet: { SubnetId: 'subnet-00000000000000001' }, input };
      }
      if (method === 'createVpc') {
        return { Vpc: { VpcId: 'vpc-00000000000000001' }, input };
      }
      if (method === 'describeInternetGateways') {
        return { InternetGateways: [], input };
      }
      if (method === 'describeRouteTables') return { RouteTables: [], input };
      if (method === 'describeSecurityGroups') {
        return { SecurityGroups: [], input };
      }
      if (method === 'describeSubnets') return { Subnets: [], input };
      if (method === 'describeVpcs') return { Vpcs: [], input };
      if (method === 'describeVpcAttribute') {
        return { EnableDnsSupport: { Value: true }, input };
      }
      if (method === 'associateRouteTable') {
        return {
          AssociationId: 'rtbassoc-00000000000000001',
          AssociationState: { State: 'associated' },
          input,
        };
      }
      if (method === 'attachInternetGateway') return { input };
      if (method === 'disassociateRouteTable') return { Return: true, input };
      if (method === 'detachInternetGateway') return { input };
      if (method === 'deleteInternetGateway') return { input };
      if (method === 'deleteRoute') return { Return: true, input };
      if (method === 'deleteRouteTable') return { input };
      if (method === 'deleteSecurityGroup') return { input };
      if (method === 'deleteSubnet') return { input };
      if (method === 'deleteVpc') return { input };
      throw new Error(`Unexpected EC2 method: ${method}`);
    },
  );
  const iamSend = jest.fn(
    async (/** @type {string} */ method, /** @type {unknown} */ input) => {
      if (iamMethodError) throw iamMethodError;
      return { operation: method, input };
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
  jest.unstable_mockModule('@aws-sdk/client-ssm', () => ({
    GetParameterCommand: class GetParameterCommand {
      input;

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    SSMClient: class SSMClient {
      constructor(/** @type {Record<string, any>} */ config) {
        if (ssmConstructionError) throw ssmConstructionError;
        ssmConfigs.push(config);
      }

      send(/** @type {{input: unknown}} */ command) {
        return ssmSend(command.input);
      }

      destroy() {
        ssmDestroy();
      }
    },
  }));
  jest.unstable_mockModule('@aws-sdk/client-iam', () => {
    /** @param {string} operation - Mock operation identity. */
    const createCommand = (operation) =>
      class Command {
        operation = operation;
        input;

        constructor(/** @type {unknown} */ input) {
          this.input = input;
        }
      };
    return {
      AddRoleToInstanceProfileCommand: createCommand(
        'addRoleToInstanceProfile',
      ),
      CreateInstanceProfileCommand: createCommand('createInstanceProfile'),
      CreateRoleCommand: createCommand('createRole'),
      DeleteInstanceProfileCommand: createCommand('deleteInstanceProfile'),
      DeleteRoleCommand: createCommand('deleteRole'),
      DeleteRolePolicyCommand: createCommand('deleteRolePolicy'),
      GetInstanceProfileCommand: createCommand('getInstanceProfile'),
      GetRoleCommand: createCommand('getRole'),
      GetRolePolicyCommand: createCommand('getRolePolicy'),
      IAMClient: class IAMClient {
        constructor(/** @type {Record<string, any>} */ config) {
          if (iamConstructionError) throw iamConstructionError;
          iamConfigs.push(config);
        }

        send(/** @type {{operation: string, input: unknown}} */ command) {
          return iamSend(command.operation, command.input);
        }

        destroy() {
          iamDestroy();
        }
      },
      ListAttachedRolePoliciesCommand: createCommand(
        'listAttachedRolePolicies',
      ),
      ListInstanceProfilesForRoleCommand: createCommand(
        'listInstanceProfilesForRole',
      ),
      ListInstanceProfileTagsCommand: createCommand('listInstanceProfileTags'),
      ListRolePoliciesCommand: createCommand('listRolePolicies'),
      ListRoleTagsCommand: createCommand('listRoleTags'),
      PutRolePolicyCommand: createCommand('putRolePolicy'),
      RemoveRoleFromInstanceProfileCommand: createCommand(
        'removeRoleFromInstanceProfile',
      ),
    };
  });
  jest.unstable_mockModule('@aws-sdk/client-ec2', () => ({
    AssociateRouteTableCommand: class AssociateRouteTableCommand {
      input;
      operation = 'associateRouteTable';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    AttachInternetGatewayCommand: class AttachInternetGatewayCommand {
      input;
      operation = 'attachInternetGateway';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    CreateInternetGatewayCommand: class CreateInternetGatewayCommand {
      input;
      operation = 'createInternetGateway';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    CreateRouteCommand: class CreateRouteCommand {
      input;
      operation = 'createRoute';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    CreateRouteTableCommand: class CreateRouteTableCommand {
      input;
      operation = 'createRouteTable';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    CreateSecurityGroupCommand: class CreateSecurityGroupCommand {
      input;
      operation = 'createSecurityGroup';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    CreateSubnetCommand: class CreateSubnetCommand {
      input;
      operation = 'createSubnet';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    CreateVpcCommand: class CreateVpcCommand {
      input;
      operation = 'createVpc';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    CreateVolumeCommand: class CreateVolumeCommand {
      input;
      operation = 'createVolume';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DescribeAvailabilityZonesCommand: class DescribeAvailabilityZonesCommand {
      input;
      operation = 'describeAvailabilityZones';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DescribeImagesCommand: class DescribeImagesCommand {
      input;
      operation = 'describeImages';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DescribeInstancesCommand: class DescribeInstancesCommand {
      input;
      operation = 'describeInstances';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DescribeInternetGatewaysCommand: class DescribeInternetGatewaysCommand {
      input;
      operation = 'describeInternetGateways';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DescribeRouteTablesCommand: class DescribeRouteTablesCommand {
      input;
      operation = 'describeRouteTables';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DescribeSecurityGroupsCommand: class DescribeSecurityGroupsCommand {
      input;
      operation = 'describeSecurityGroups';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DescribeSubnetsCommand: class DescribeSubnetsCommand {
      input;
      operation = 'describeSubnets';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DescribeInstanceTypeOfferingsCommand: class DescribeInstanceTypeOfferingsCommand {
      input;
      operation = 'describeInstanceTypeOfferings';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DescribeVolumesCommand: class DescribeVolumesCommand {
      input;
      operation = 'describeVolumes';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DeleteVpcCommand: class DeleteVpcCommand {
      input;
      operation = 'deleteVpc';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DeleteInternetGatewayCommand: class DeleteInternetGatewayCommand {
      input;
      operation = 'deleteInternetGateway';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DeleteRouteCommand: class DeleteRouteCommand {
      input;
      operation = 'deleteRoute';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DeleteRouteTableCommand: class DeleteRouteTableCommand {
      input;
      operation = 'deleteRouteTable';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DeleteSecurityGroupCommand: class DeleteSecurityGroupCommand {
      input;
      operation = 'deleteSecurityGroup';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DeleteSubnetCommand: class DeleteSubnetCommand {
      input;
      operation = 'deleteSubnet';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DisassociateRouteTableCommand: class DisassociateRouteTableCommand {
      input;
      operation = 'disassociateRouteTable';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DetachInternetGatewayCommand: class DetachInternetGatewayCommand {
      input;
      operation = 'detachInternetGateway';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DescribeVpcAttributeCommand: class DescribeVpcAttributeCommand {
      input;
      operation = 'describeVpcAttribute';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    DescribeVpcsCommand: class DescribeVpcsCommand {
      input;
      operation = 'describeVpcs';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
      }
    },
    EC2Client: class EC2Client {
      constructor(/** @type {Record<string, any>} */ config) {
        if (ec2ConstructionError) throw ec2ConstructionError;
        ec2Configs.push(config);
      }

      send(/** @type {{operation: string, input: unknown}} */ command) {
        return ec2Send(command.operation, command.input);
      }

      destroy() {
        ec2Destroy();
      }
    },
    GetEbsDefaultKmsKeyIdCommand: class GetEbsDefaultKmsKeyIdCommand {
      input;
      operation = 'getEbsDefaultKmsKeyId';

      constructor(/** @type {unknown} */ input) {
        this.input = input;
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
    ssmConfigs,
    ec2Configs,
    iamConfigs,
    stsSend,
    stsDestroy,
    dynamoDestroy,
    dynamoSend,
    documentDestroy,
    s3Destroy,
    s3Send,
    ssmDestroy,
    ec2Destroy,
    iamDestroy,
    ssmSend,
    ec2Send,
    iamSend,
  };
}

describe('AWS deployment invocation authority', () => {
  it('pins explicit region and one credential snapshot across every issued client', async () => {
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
      const providerSpecReadClient = authority.createProviderSpecReadClient();
      const volumeResourceClient = authority.createVolumeResourceClient();
      const networkResourceClient = authority.createNetworkResourceClient();
      expect(harness.dynamoConfigs[0].region).toBe('us-east-1');
      expect(harness.dynamoConfigs[0].credentials).toBe(credentials);
      expect(harness.dynamoConfigs[1].region).toBe('us-east-1');
      expect(harness.dynamoConfigs[1].credentials).toBe(credentials);
      expect(harness.s3Configs[0].region).toBe('us-east-1');
      expect(harness.s3Configs[0].credentials).toBe(credentials);
      expect(harness.ssmConfigs[0].region).toBe('us-east-1');
      expect(harness.ssmConfigs[0].credentials).toBe(credentials);
      expect(harness.ec2Configs[0].region).toBe('us-east-1');
      expect(harness.ec2Configs[0].credentials).toBe(credentials);
      expect(harness.ec2Configs[1].region).toBe('us-east-1');
      expect(harness.ec2Configs[1].credentials).toBe(credentials);
      expect(harness.ec2Configs[2].region).toBe('us-east-1');
      expect(harness.ec2Configs[2].credentials).toBe(credentials);
      expect(harness.ec2Configs[2]).not.toBe(harness.ec2Configs[1]);
      expect(harness.ec2Configs[2].retryStrategy).not.toBe(
        harness.ec2Configs[1].retryStrategy,
      );
      await expect(
        harness.ec2Configs[1].retryStrategy.maxAttempts(),
      ).resolves.toBe(20);
      await expect(
        harness.ec2Configs[2].retryStrategy.maxAttempts(),
      ).resolves.toBe(1);
      expect(Object.isFrozen(controlClient)).toBe(true);
      expect(Object.isFrozen(s3ControlClient)).toBe(true);
      expect(Object.isFrozen(providerSpecReadClient)).toBe(true);
      expect(Object.isFrozen(volumeResourceClient)).toBe(true);
      expect(Object.isFrozen(networkResourceClient)).toBe(true);
      expect(controlClient).not.toHaveProperty('config');
      expect(s3ControlClient).not.toHaveProperty('config');
      expect(providerSpecReadClient).not.toHaveProperty('config');
      expect(volumeResourceClient).not.toHaveProperty('config');
      expect(networkResourceClient).not.toHaveProperty('config');
      await controlClient.describeTable({ TableName: 'control-table' });
      expect(harness.dynamoSend).toHaveBeenCalledWith('describeTable', {
        TableName: 'control-table',
      });
      await s3ControlClient.headBucket({ Bucket: 'control-bucket' });
      expect(harness.s3Send).toHaveBeenCalledWith('headBucket', {
        Bucket: 'control-bucket',
      });
      await providerSpecReadClient.getParameter({ Name: '/wharfie/image' });
      expect(harness.ssmSend).toHaveBeenCalledWith({
        Name: '/wharfie/image',
      });
      await providerSpecReadClient.describeImages({
        ImageIds: ['ami-00000000000000001'],
      });
      expect(harness.ec2Send).toHaveBeenCalledWith('describeImages', {
        ImageIds: ['ami-00000000000000001'],
      });
      await volumeResourceClient.createVolume({
        AvailabilityZone: 'us-east-1a',
        ClientToken: 'volume-token',
        Size: 8,
      });
      expect(harness.ec2Send).toHaveBeenCalledWith('createVolume', {
        AvailabilityZone: 'us-east-1a',
        ClientToken: 'volume-token',
        Size: 8,
      });
      await networkResourceClient.createVpc({ CidrBlock: '10.42.0.0/16' });
      expect(harness.ec2Send).toHaveBeenCalledWith('createVpc', {
        CidrBlock: '10.42.0.0/16',
      });
      await expect(authority.resolveScope()).resolves.toEqual(
        authority.providerScope,
      );
      expect(harness.stsSend).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(authority)).not.toMatch(/AKIA|never-print/);
      await db.close();
      await controlClient.close();
      await s3ControlClient.close();
      await providerSpecReadClient.close();
      await volumeResourceClient.close();
      await networkResourceClient.close();
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

  it('exposes only the exact narrow provider-spec read surface', async () => {
    const harness = await loadHarness();
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    const client = /** @type {Record<string, any>} */ (
      authority.createProviderSpecReadClient()
    );
    try {
      expect(Object.keys(client).sort()).toEqual(
        [...PROVIDER_SPEC_READ_METHODS, 'close'].sort(),
      );
      expect(client).not.toHaveProperty('config');
      expect(client).not.toHaveProperty('credentials');
      expect(client).not.toHaveProperty('destroy');
      expect(client).not.toHaveProperty('send');
      expect(JSON.stringify(client)).not.toMatch(/AKIA|never-print/);

      await expect(
        client.getParameter({ Name: '/wharfie/provider/image' }),
      ).resolves.toMatchObject({
        Parameter: { Value: 'resolved-parameter' },
        input: { Name: '/wharfie/provider/image' },
      });
      await expect(
        client.describeAvailabilityZones({
          Filters: [{ Name: 'state', Values: ['available'] }],
        }),
      ).resolves.toMatchObject({
        AvailabilityZones: [],
        input: { Filters: [{ Name: 'state', Values: ['available'] }] },
      });
      await expect(
        client.describeImages({ ImageIds: ['ami-00000000000000001'] }),
      ).resolves.toMatchObject({
        Images: [],
        input: { ImageIds: ['ami-00000000000000001'] },
      });
      await expect(
        client.describeInstanceTypeOfferings({
          LocationType: 'availability-zone',
        }),
      ).resolves.toMatchObject({
        InstanceTypeOfferings: [],
        input: { LocationType: 'availability-zone' },
      });
      await expect(client.getEbsDefaultKmsKeyId({})).resolves.toMatchObject({
        KmsKeyId:
          'arn:aws:kms:us-east-1:123456789012:key/00000000-0000-4000-8000-000000000001',
        input: {},
      });
      expect(harness.ec2Send.mock.calls).toEqual([
        [
          'describeAvailabilityZones',
          { Filters: [{ Name: 'state', Values: ['available'] }] },
        ],
        ['describeImages', { ImageIds: ['ami-00000000000000001'] }],
        [
          'describeInstanceTypeOfferings',
          { LocationType: 'availability-zone' },
        ],
        ['getEbsDefaultKmsKeyId', {}],
      ]);
    } finally {
      await client.close();
      await authority.close();
    }
  });

  it('replaces provider-spec read construction failures and cleans partial construction', async () => {
    const ssmHarness = await loadHarness({
      ssmConstructionError: new Error('ssm-construction-secret'),
    });
    const ssmAuthority = await ssmHarness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    expect(() => ssmAuthority.createProviderSpecReadClient()).toThrow(
      'AWS deployment provider-spec read client creation failed.',
    );
    expect(ssmHarness.ec2Configs).toHaveLength(0);
    expect(ssmHarness.ssmDestroy).not.toHaveBeenCalled();
    await ssmAuthority.close();

    const ec2Harness = await loadHarness({
      ec2ConstructionError: new Error('ec2-construction-secret'),
      ssmCloseError: new Error('partial-cleanup-secret'),
    });
    const ec2Authority = await ec2Harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    expect(() => ec2Authority.createProviderSpecReadClient()).toThrow(
      'AWS deployment provider-spec read client creation failed.',
    );
    expect(ec2Harness.ssmDestroy).toHaveBeenCalledTimes(1);
    expect(ec2Harness.ec2Destroy).not.toHaveBeenCalled();
    await ec2Authority.close();
  });

  it.each(['ParameterNotFound', 'ParameterVersionNotFound'])(
    'preserves only the %s provider-spec missing classification',
    async (name) => {
      const providerError = Object.assign(new Error('parameter-secret'), {
        name,
        code: 'provider-code-secret',
        $metadata: {
          httpStatusCode: 400,
          requestId: 'provider-request-secret',
        },
      });
      const harness = await loadHarness({ ssmMethodError: providerError });
      const authority = await harness.createAwsDeploymentAuthority({
        region: 'us-east-1',
      });
      const client = authority.createProviderSpecReadClient();

      const observed = await client
        .getParameter({ Name: '/wharfie/provider/missing' })
        .catch((/** @type {unknown} */ error) => error);
      expect(observed).not.toBe(providerError);
      expect(observed).toMatchObject({
        name,
        code: 'AWS_DEPLOYMENT_PROVIDER_SPEC_READ_OPERATION',
        message: 'AWS deployment provider-spec read operation failed.',
        $metadata: { httpStatusCode: 400 },
      });
      expect(JSON.stringify(observed)).not.toMatch(
        /parameter-secret|provider-code-secret|provider-request-secret/,
      );

      await client.close();
      await authority.close();
    },
  );

  it('keeps access and unknown provider-spec failures generic and non-echoing', async () => {
    const providerError = Object.assign(new Error('access-secret'), {
      name: 'AccessDeniedException',
      code: 'provider-code-secret',
      $metadata: {
        httpStatusCode: 403,
        requestId: 'provider-request-secret',
      },
    });
    const harness = await loadHarness({ ec2MethodError: providerError });
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    const client = authority.createProviderSpecReadClient();

    const observed = await client
      .describeImages({ ImageIds: ['ami-00000000000000001'] })
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).not.toBe(providerError);
    expect(observed).toMatchObject({
      name: 'AwsDeploymentProviderSpecReadError',
      code: 'AWS_DEPLOYMENT_PROVIDER_SPEC_READ_OPERATION',
      message: 'AWS deployment provider-spec read operation failed.',
      $metadata: { httpStatusCode: 403 },
    });
    expect(JSON.stringify(observed)).not.toMatch(
      /AccessDenied|access-secret|provider-code-secret|provider-request-secret/,
    );

    await client.close();
    await authority.close();
  });

  it('closes both provider-spec SDK clients once after a partial close failure', async () => {
    const harness = await loadHarness({
      ssmCloseError: new Error('ssm-close-secret'),
    });
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    const client = authority.createProviderSpecReadClient();

    const firstClose = client.close();
    expect(client.close()).toBe(firstClose);
    await expect(firstClose).rejects.toThrow(
      'AWS deployment provider-spec read client close failed.',
    );
    expect(harness.ssmDestroy).toHaveBeenCalledTimes(1);
    expect(harness.ec2Destroy).toHaveBeenCalledTimes(1);
    await expect(
      client.getParameter({ Name: '/wharfie/provider/closed' }),
    ).rejects.toThrow('AWS deployment provider-spec read client is closed.');
    await expect(
      client.describeImages({ ImageIds: ['ami-00000000000000001'] }),
    ).rejects.toThrow('AWS deployment provider-spec read client is closed.');
    await authority.close();
  });

  it('exposes only the exact narrow volume resource surface', async () => {
    const harness = await loadHarness();
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    const client = /** @type {Record<string, any>} */ (
      authority.createVolumeResourceClient()
    );
    try {
      expect(Object.keys(client).sort()).toEqual(
        [...VOLUME_RESOURCE_METHODS, 'close'].sort(),
      );
      expect(client).not.toHaveProperty('config');
      expect(client).not.toHaveProperty('credentials');
      expect(client).not.toHaveProperty('destroy');
      expect(client).not.toHaveProperty('send');
      expect(JSON.stringify(client)).not.toMatch(/AKIA|never-print/);

      const createInput = {
        AvailabilityZone: 'us-east-1a',
        ClientToken: 'volume-token',
        Size: 8,
      };
      await expect(client.createVolume(createInput)).resolves.toMatchObject({
        VolumeId: 'vol-00000000000000001',
        input: createInput,
      });
      const describeInput = { VolumeIds: ['vol-00000000000000001'] };
      await expect(
        client.describeVolumes(describeInput),
      ).resolves.toMatchObject({ Volumes: [], input: describeInput });
      expect(harness.ec2Send.mock.calls).toEqual([
        ['createVolume', createInput],
        ['describeVolumes', describeInput],
      ]);
    } finally {
      await client.close();
      await authority.close();
    }
  });

  it('replaces volume resource client construction failures', async () => {
    const harness = await loadHarness({
      ec2ConstructionError: new Error('volume-construction-secret'),
    });
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });

    expect(() => authority.createVolumeResourceClient()).toThrow(
      'AWS deployment volume resource client creation failed.',
    );
    expect(harness.ec2Configs).toHaveLength(0);
    expect(harness.ec2Destroy).not.toHaveBeenCalled();
    await authority.close();
  });

  it.each([
    ['IdempotentParameterMismatch', 'createVolume', 400],
    ['InvalidVolume.NotFound', 'describeVolumes', 404],
  ])(
    'preserves only the %s volume resource classification',
    async (name, method, status) => {
      const providerError = Object.assign(new Error('volume-secret'), {
        name,
        code: 'provider-code-secret',
        $metadata: {
          httpStatusCode: status,
          requestId: 'provider-request-secret',
        },
      });
      const harness = await loadHarness({ ec2MethodError: providerError });
      const authority = await harness.createAwsDeploymentAuthority({
        region: 'us-east-1',
      });
      const client = /** @type {Record<string, any>} */ (
        authority.createVolumeResourceClient()
      );

      const observed = await client[method]({ operationMarker: method }).catch(
        (/** @type {unknown} */ error) => error,
      );
      expect(observed).not.toBe(providerError);
      expect(observed).toMatchObject({
        name,
        code: 'AWS_DEPLOYMENT_VOLUME_RESOURCE_OPERATION',
        message: 'AWS deployment volume resource operation failed.',
        $metadata: { httpStatusCode: status },
      });
      expect(JSON.stringify(observed)).not.toMatch(
        /volume-secret|provider-code-secret|provider-request-secret/,
      );

      await client.close();
      await authority.close();
    },
  );

  it.each([
    [403, true],
    [399, false],
    [600, false],
    ['403', false],
  ])(
    'keeps unknown volume failures generic and safely handles status %p',
    async (status, preservesStatus) => {
      const providerError = Object.assign(new Error('volume-access-secret'), {
        name: 'AccessDeniedException',
        code: 'provider-code-secret',
        $metadata: {
          httpStatusCode: status,
          requestId: 'provider-request-secret',
        },
      });
      const harness = await loadHarness({ ec2MethodError: providerError });
      const authority = await harness.createAwsDeploymentAuthority({
        region: 'us-east-1',
      });
      const client = authority.createVolumeResourceClient();

      const observed = await client
        .describeVolumes({ VolumeIds: ['vol-00000000000000001'] })
        .catch((/** @type {unknown} */ error) => error);
      expect(observed).not.toBe(providerError);
      expect(observed).toMatchObject({
        name: 'AwsDeploymentVolumeResourceError',
        code: 'AWS_DEPLOYMENT_VOLUME_RESOURCE_OPERATION',
        message: 'AWS deployment volume resource operation failed.',
      });
      if (preservesStatus) {
        expect(observed).toHaveProperty('$metadata.httpStatusCode', status);
      } else {
        expect(observed).not.toHaveProperty('$metadata');
      }
      expect(JSON.stringify(observed)).not.toMatch(
        /AccessDenied|volume-access-secret|provider-code-secret|provider-request-secret/,
      );

      await client.close();
      await authority.close();
    },
  );

  it('closes the volume resource SDK client idempotently and refuses reuse', async () => {
    const harness = await loadHarness({
      ec2CloseError: new Error('volume-close-secret'),
    });
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    const client = authority.createVolumeResourceClient();

    const firstClose = client.close();
    expect(client.close()).toBe(firstClose);
    await expect(firstClose).rejects.toThrow(
      'AWS deployment volume resource client close failed.',
    );
    expect(harness.ec2Destroy).toHaveBeenCalledTimes(1);
    await expect(
      client.createVolume({ AvailabilityZone: 'us-east-1a' }),
    ).rejects.toThrow('AWS deployment volume resource client is closed.');
    await expect(
      client.describeVolumes({ VolumeIds: ['vol-00000000000000001'] }),
    ).rejects.toThrow('AWS deployment volume resource client is closed.');
    await authority.close();
  });

  it('exposes only the exact narrow network resource surface and dispatches every operation', async () => {
    const harness = await loadHarness();
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    const client = /** @type {Record<string, any>} */ (
      authority.createNetworkResourceClient()
    );
    try {
      expect(Object.keys(client).sort()).toEqual(
        [...NETWORK_RESOURCE_METHODS, 'close'].sort(),
      );
      expect(Object.isFrozen(client)).toBe(true);
      expect(client).not.toHaveProperty('config');
      expect(client).not.toHaveProperty('credentials');
      expect(client).not.toHaveProperty('destroy');
      expect(client).not.toHaveProperty('send');
      expect(JSON.stringify(client)).not.toMatch(/AKIA|never-print/);

      const associateRouteTableInput = {
        RouteTableId: 'rtb-00000000000000001',
        SubnetId: 'subnet-00000000000000001',
      };
      await expect(
        client.associateRouteTable(associateRouteTableInput),
      ).resolves.toEqual({
        AssociationId: 'rtbassoc-00000000000000001',
        AssociationState: { State: 'associated' },
        input: associateRouteTableInput,
      });
      const attachmentInput = {
        InternetGatewayId: 'igw-00000000000000001',
        VpcId: 'vpc-00000000000000001',
      };
      await expect(
        client.attachInternetGateway(attachmentInput),
      ).resolves.toEqual({ input: attachmentInput });
      const createInternetGatewayInput = {
        TagSpecifications: [
          {
            ResourceType: 'internet-gateway',
            Tags: [{ Key: 'wharfie:managed-by', Value: 'wharfie' }],
          },
        ],
      };
      await expect(
        client.createInternetGateway(createInternetGatewayInput),
      ).resolves.toMatchObject({
        InternetGateway: {
          InternetGatewayId: 'igw-00000000000000001',
        },
        input: createInternetGatewayInput,
      });
      const createRouteInput = {
        DestinationCidrBlock: '0.0.0.0/0',
        GatewayId: 'igw-00000000000000001',
        RouteTableId: 'rtb-00000000000000001',
      };
      await expect(client.createRoute(createRouteInput)).resolves.toEqual({
        Return: true,
        input: createRouteInput,
      });
      const createInput = { CidrBlock: '10.42.0.0/16' };
      await expect(client.createVpc(createInput)).resolves.toMatchObject({
        Vpc: { VpcId: 'vpc-00000000000000001' },
        input: createInput,
      });
      const createRouteTableInput = {
        ClientToken:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        VpcId: 'vpc-00000000000000001',
      };
      await expect(
        client.createRouteTable(createRouteTableInput),
      ).resolves.toMatchObject({
        RouteTable: { RouteTableId: 'rtb-00000000000000001' },
        input: createRouteTableInput,
      });
      const createSecurityGroupInput = {
        Description: 'Wharfie application security group',
        GroupName: 'wharfie-application',
        VpcId: 'vpc-00000000000000001',
      };
      await expect(
        client.createSecurityGroup(createSecurityGroupInput),
      ).resolves.toEqual({
        GroupId: 'sg-00000000000000001',
        input: createSecurityGroupInput,
      });
      const createSubnetInput = {
        AvailabilityZoneId: 'use1-az1',
        CidrBlock: '10.42.1.0/24',
        VpcId: 'vpc-00000000000000001',
      };
      await expect(
        client.createSubnet(createSubnetInput),
      ).resolves.toMatchObject({
        Subnet: { SubnetId: 'subnet-00000000000000001' },
        input: createSubnetInput,
      });
      const describeInternetGatewaysInput = {
        InternetGatewayIds: ['igw-00000000000000001'],
      };
      await expect(
        client.describeInternetGateways(describeInternetGatewaysInput),
      ).resolves.toMatchObject({
        InternetGateways: [],
        input: describeInternetGatewaysInput,
      });
      const describeRouteTablesInput = {
        RouteTableIds: ['rtb-00000000000000001'],
      };
      await expect(
        client.describeRouteTables(describeRouteTablesInput),
      ).resolves.toMatchObject({
        RouteTables: [],
        input: describeRouteTablesInput,
      });
      const describeSecurityGroupsInput = {
        GroupIds: ['sg-00000000000000001'],
      };
      await expect(
        client.describeSecurityGroups(describeSecurityGroupsInput),
      ).resolves.toMatchObject({
        SecurityGroups: [],
        input: describeSecurityGroupsInput,
      });
      const describeSubnetsInput = {
        SubnetIds: ['subnet-00000000000000001'],
      };
      await expect(
        client.describeSubnets(describeSubnetsInput),
      ).resolves.toMatchObject({
        Subnets: [],
        input: describeSubnetsInput,
      });
      const describeInput = { VpcIds: ['vpc-00000000000000001'] };
      await expect(client.describeVpcs(describeInput)).resolves.toMatchObject({
        Vpcs: [],
        input: describeInput,
      });
      const attributeInput = {
        VpcId: 'vpc-00000000000000001',
        Attribute: 'enableDnsSupport',
      };
      await expect(
        client.describeVpcAttribute(attributeInput),
      ).resolves.toMatchObject({
        EnableDnsSupport: { Value: true },
        input: attributeInput,
      });
      const disassociateRouteTableInput = {
        AssociationId: 'rtbassoc-00000000000000001',
      };
      await expect(
        client.disassociateRouteTable(disassociateRouteTableInput),
      ).resolves.toEqual({
        Return: true,
        input: disassociateRouteTableInput,
      });
      const detachInput = {
        InternetGatewayId: 'igw-00000000000000001',
        VpcId: 'vpc-00000000000000001',
      };
      await expect(client.detachInternetGateway(detachInput)).resolves.toEqual({
        input: detachInput,
      });
      const deleteInternetGatewayInput = {
        InternetGatewayId: 'igw-00000000000000001',
      };
      await expect(
        client.deleteInternetGateway(deleteInternetGatewayInput),
      ).resolves.toEqual({ input: deleteInternetGatewayInput });
      const deleteRouteInput = {
        DestinationCidrBlock: '0.0.0.0/0',
        RouteTableId: 'rtb-00000000000000001',
      };
      await expect(client.deleteRoute(deleteRouteInput)).resolves.toEqual({
        Return: true,
        input: deleteRouteInput,
      });
      const deleteRouteTableInput = {
        RouteTableId: 'rtb-00000000000000001',
      };
      await expect(
        client.deleteRouteTable(deleteRouteTableInput),
      ).resolves.toEqual({ input: deleteRouteTableInput });
      const deleteSecurityGroupInput = {
        GroupId: 'sg-00000000000000001',
      };
      await expect(
        client.deleteSecurityGroup(deleteSecurityGroupInput),
      ).resolves.toEqual({ input: deleteSecurityGroupInput });
      const deleteSubnetInput = {
        SubnetId: 'subnet-00000000000000001',
      };
      await expect(client.deleteSubnet(deleteSubnetInput)).resolves.toEqual({
        input: deleteSubnetInput,
      });
      const deleteInput = { VpcId: 'vpc-00000000000000001' };
      await expect(client.deleteVpc(deleteInput)).resolves.toEqual({
        input: deleteInput,
      });
      expect(harness.ec2Send.mock.calls).toEqual([
        ['associateRouteTable', associateRouteTableInput],
        ['attachInternetGateway', attachmentInput],
        ['createInternetGateway', createInternetGatewayInput],
        ['createRoute', createRouteInput],
        ['createVpc', createInput],
        ['createRouteTable', createRouteTableInput],
        ['createSecurityGroup', createSecurityGroupInput],
        ['createSubnet', createSubnetInput],
        ['describeInternetGateways', describeInternetGatewaysInput],
        ['describeRouteTables', describeRouteTablesInput],
        ['describeSecurityGroups', describeSecurityGroupsInput],
        ['describeSubnets', describeSubnetsInput],
        ['describeVpcs', describeInput],
        ['describeVpcAttribute', attributeInput],
        ['disassociateRouteTable', disassociateRouteTableInput],
        ['detachInternetGateway', detachInput],
        ['deleteInternetGateway', deleteInternetGatewayInput],
        ['deleteRoute', deleteRouteInput],
        ['deleteRouteTable', deleteRouteTableInput],
        ['deleteSecurityGroup', deleteSecurityGroupInput],
        ['deleteSubnet', deleteSubnetInput],
        ['deleteVpc', deleteInput],
      ]);
    } finally {
      await client.close();
      await authority.close();
    }
  });

  it('replaces network resource client construction failures', async () => {
    const harness = await loadHarness({
      ec2ConstructionError: new Error('network-construction-secret'),
    });
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });

    expect(() => authority.createNetworkResourceClient()).toThrow(
      'AWS deployment network resource client creation failed.',
    );
    expect(harness.ec2Configs).toHaveLength(0);
    expect(harness.ec2Destroy).not.toHaveBeenCalled();
    await authority.close();
  });

  it.each([
    ['InvalidVpcID.NotFound', 'describeVpcs', 404],
    ['InvalidInternetGatewayID.NotFound', 'describeInternetGateways', 404],
    ['InvalidRouteTableID.NotFound', 'describeRouteTables', 404],
    ['InvalidSubnetID.NotFound', 'describeSubnets', 404],
    ['InvalidSubnetId.NotFound', 'describeSubnets', 404],
    ['InvalidAssociationID.NotFound', 'disassociateRouteTable', 404],
    ['InvalidGroup.Duplicate', 'createSecurityGroup', 400],
    ['InvalidGroup.NotFound', 'describeSecurityGroups', 404],
    ['InvalidGroup.InUse', 'deleteSecurityGroup', 400],
    ['InvalidSecurityGroupID.NotFound', 'describeSecurityGroups', 404],
    ['IdempotentParameterMismatch', 'createRouteTable', 400],
    ['DependencyViolation', 'deleteVpc', 400],
    ['IncorrectState', 'deleteVpc', 400],
    ['Gateway.NotAttached', 'detachInternetGateway', 400],
    ['Resource.AlreadyAssociated', 'attachInternetGateway', 400],
    ['RouteAlreadyExists', 'createRoute', 400],
    ['InvalidGatewayID.NotFound', 'createRoute', 400],
    ['InvalidRoute.NotFound', 'deleteRoute', 400],
  ])(
    'preserves only the %s network resource classification',
    async (name, method, status) => {
      const providerError = Object.assign(new Error('network-secret'), {
        name,
        code: 'provider-code-secret',
        $metadata: {
          httpStatusCode: status,
          requestId: 'provider-request-secret',
        },
      });
      const harness = await loadHarness({ ec2MethodError: providerError });
      const authority = await harness.createAwsDeploymentAuthority({
        region: 'us-east-1',
      });
      const client = /** @type {Record<string, any>} */ (
        authority.createNetworkResourceClient()
      );

      const observed = await client[method]({ operationMarker: method }).catch(
        (/** @type {unknown} */ error) => error,
      );
      expect(observed).not.toBe(providerError);
      expect(observed).toMatchObject({
        name,
        code: 'AWS_DEPLOYMENT_NETWORK_RESOURCE_OPERATION',
        message: 'AWS deployment network resource operation failed.',
        $metadata: { httpStatusCode: status },
      });
      expect(JSON.stringify(observed)).not.toMatch(
        /network-secret|provider-code-secret|provider-request-secret/,
      );

      await client.close();
      await authority.close();
    },
  );

  it.each([
    [403, true],
    [399, false],
    [600, false],
    ['403', false],
  ])(
    'keeps unknown network failures generic and safely handles status %p',
    async (status, preservesStatus) => {
      const providerError = Object.assign(new Error('network-access-secret'), {
        name: 'AccessDeniedException',
        code: 'provider-code-secret',
        $metadata: {
          httpStatusCode: status,
          requestId: 'provider-request-secret',
        },
      });
      const harness = await loadHarness({ ec2MethodError: providerError });
      const authority = await harness.createAwsDeploymentAuthority({
        region: 'us-east-1',
      });
      const client = authority.createNetworkResourceClient();

      const observed = await client
        .describeVpcAttribute({
          VpcId: 'vpc-00000000000000001',
          Attribute: 'enableDnsSupport',
        })
        .catch((/** @type {unknown} */ error) => error);
      expect(observed).not.toBe(providerError);
      expect(observed).toMatchObject({
        name: 'AwsDeploymentNetworkResourceError',
        code: 'AWS_DEPLOYMENT_NETWORK_RESOURCE_OPERATION',
        message: 'AWS deployment network resource operation failed.',
      });
      if (preservesStatus) {
        expect(observed).toHaveProperty('$metadata.httpStatusCode', status);
      } else {
        expect(observed).not.toHaveProperty('$metadata');
      }
      expect(JSON.stringify(observed)).not.toMatch(
        /AccessDenied|network-access-secret|provider-code-secret|provider-request-secret/,
      );

      await client.close();
      await authority.close();
    },
  );

  it('closes the network resource SDK client idempotently and refuses every reuse', async () => {
    const harness = await loadHarness({
      ec2CloseError: new Error('network-close-secret'),
    });
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    const client = /** @type {Record<string, any>} */ (
      authority.createNetworkResourceClient()
    );

    const firstClose = client.close();
    expect(client.close()).toBe(firstClose);
    await expect(firstClose).rejects.toThrow(
      'AWS deployment network resource client close failed.',
    );
    expect(harness.ec2Destroy).toHaveBeenCalledTimes(1);
    for (const method of NETWORK_RESOURCE_METHODS) {
      await expect(client[method]({})).rejects.toThrow(
        'AWS deployment network resource client is closed.',
      );
    }
    await authority.close();
  });

  it('exposes only the exact runtime-identity surface and dispatches every operation with one snapshot', async () => {
    const harness = await loadHarness();
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    const client = /** @type {Record<string, any>} */ (
      authority.createRuntimeIdentityResourceClient()
    );
    try {
      expect(Object.keys(client).sort()).toEqual(
        [...RUNTIME_IDENTITY_RESOURCE_METHODS, 'close'].sort(),
      );
      expect(Object.isFrozen(client)).toBe(true);
      expect(client).not.toHaveProperty('config');
      expect(client).not.toHaveProperty('credentials');
      expect(client).not.toHaveProperty('destroy');
      expect(client).not.toHaveProperty('send');
      expect(JSON.stringify(client)).not.toMatch(/AKIA|never-print/);

      expect(harness.iamConfigs).toHaveLength(1);
      expect(harness.ec2Configs).toHaveLength(1);
      expect(harness.iamConfigs[0]).toMatchObject({ region: 'us-east-1' });
      expect(harness.ec2Configs[0]).toMatchObject({ region: 'us-east-1' });
      expect(harness.iamConfigs[0].credentials).toBe(
        harness.stsConfigs[0].credentials,
      );
      expect(harness.ec2Configs[0].credentials).toBe(
        harness.stsConfigs[0].credentials,
      );
      expect(Object.isFrozen(harness.iamConfigs[0].credentials)).toBe(true);
      await expect(
        harness.iamConfigs[0].retryStrategy.maxAttempts(),
      ).resolves.toBe(1);
      await expect(
        harness.ec2Configs[0].retryStrategy.maxAttempts(),
      ).resolves.toBe(1);

      for (const method of RUNTIME_IDENTITY_RESOURCE_METHODS) {
        const input = { operationMarker: method };
        await expect(client[method](input)).resolves.toMatchObject({ input });
        if (method === 'describeInstances') {
          expect(harness.ec2Send).toHaveBeenLastCalledWith(method, input);
        } else {
          expect(harness.iamSend).toHaveBeenLastCalledWith(method, input);
        }
      }
      expect(harness.iamSend).toHaveBeenCalledTimes(
        RUNTIME_IDENTITY_RESOURCE_METHODS.length - 1,
      );
      expect(harness.ec2Send).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await authority.close();
    }
  });

  it('replaces runtime-identity construction failures and cleans up partial construction', async () => {
    const iamHarness = await loadHarness({
      iamConstructionError: new Error('iam-construction-secret'),
    });
    const iamAuthority = await iamHarness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    expect(() => iamAuthority.createRuntimeIdentityResourceClient()).toThrow(
      'AWS deployment runtime-identity resource client creation failed.',
    );
    expect(iamHarness.iamConfigs).toHaveLength(0);
    expect(iamHarness.ec2Configs).toHaveLength(0);
    expect(iamHarness.iamDestroy).not.toHaveBeenCalled();
    expect(iamHarness.ec2Destroy).not.toHaveBeenCalled();
    await iamAuthority.close();

    const ec2Harness = await loadHarness({
      ec2ConstructionError: new Error('ec2-construction-secret'),
      iamCloseError: new Error('partial-close-secret'),
    });
    const ec2Authority = await ec2Harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    expect(() => ec2Authority.createRuntimeIdentityResourceClient()).toThrow(
      'AWS deployment runtime-identity resource client creation failed.',
    );
    expect(ec2Harness.iamConfigs).toHaveLength(1);
    expect(ec2Harness.ec2Configs).toHaveLength(0);
    expect(ec2Harness.iamDestroy).toHaveBeenCalledTimes(1);
    expect(ec2Harness.ec2Destroy).not.toHaveBeenCalled();
    await ec2Authority.close();
  });

  it.each([
    ['ConcurrentModification', 'ConcurrentModification'],
    ['ConcurrentModificationException', 'ConcurrentModification'],
    ['DeleteConflict', 'DeleteConflict'],
    ['DeleteConflictException', 'DeleteConflict'],
    ['EntityAlreadyExists', 'EntityAlreadyExists'],
    ['EntityAlreadyExistsException', 'EntityAlreadyExists'],
    ['NoSuchEntity', 'NoSuchEntity'],
    ['NoSuchEntityException', 'NoSuchEntity'],
  ])(
    'canonicalizes the %s runtime-identity classification without provider details',
    async (providerName, boundaryName) => {
      const providerError = Object.assign(new Error('iam-operation-secret'), {
        name: providerName,
        code: 'provider-code-secret',
        $metadata: {
          httpStatusCode: 409,
          requestId: 'provider-request-secret',
        },
        cause: { credentials: CREDENTIALS },
      });
      const harness = await loadHarness({ iamMethodError: providerError });
      const authority = await harness.createAwsDeploymentAuthority({
        region: 'us-east-1',
      });
      const client = authority.createRuntimeIdentityResourceClient();

      const observed = await client
        .getRole({ RoleName: 'wharfie-runtime-role' })
        .catch((/** @type {unknown} */ error) => error);
      expect(observed).not.toBe(providerError);
      expect(observed).toMatchObject({
        name: boundaryName,
        code: 'AWS_DEPLOYMENT_RUNTIME_IDENTITY_RESOURCE_OPERATION',
        message: 'AWS deployment runtime-identity resource operation failed.',
        $metadata: { httpStatusCode: 409 },
      });
      expect(JSON.stringify(observed)).not.toMatch(
        /iam-operation-secret|provider-code-secret|provider-request-secret|AKIA|never-print/,
      );

      await client.close();
      await authority.close();
    },
  );

  it.each([
    [403, true],
    [399, false],
    [600, false],
    ['403', false],
  ])(
    'keeps unknown runtime-identity failures generic and safely handles status %p',
    async (status, preservesStatus) => {
      const providerError = Object.assign(new Error('iam-access-secret'), {
        name: 'AccessDeniedException',
        code: 'provider-code-secret',
        $metadata: {
          httpStatusCode: status,
          requestId: 'provider-request-secret',
        },
      });
      const harness = await loadHarness({ ec2MethodError: providerError });
      const authority = await harness.createAwsDeploymentAuthority({
        region: 'us-east-1',
      });
      const client = authority.createRuntimeIdentityResourceClient();

      const observed = await client
        .describeInstances({
          Filters: [{ Name: 'iam-instance-profile.id', Values: ['AIPAID'] }],
        })
        .catch((/** @type {unknown} */ error) => error);
      expect(observed).not.toBe(providerError);
      expect(observed).toMatchObject({
        name: 'AwsDeploymentRuntimeIdentityResourceError',
        code: 'AWS_DEPLOYMENT_RUNTIME_IDENTITY_RESOURCE_OPERATION',
        message: 'AWS deployment runtime-identity resource operation failed.',
      });
      if (preservesStatus) {
        expect(observed).toHaveProperty('$metadata.httpStatusCode', status);
      } else {
        expect(observed).not.toHaveProperty('$metadata');
      }
      expect(JSON.stringify(observed)).not.toMatch(
        /AccessDenied|iam-access-secret|provider-code-secret|provider-request-secret/,
      );

      await client.close();
      await authority.close();
    },
  );

  it('closes both runtime-identity SDK clients idempotently and refuses every reuse', async () => {
    const harness = await loadHarness({
      iamCloseError: new Error('iam-close-secret'),
      ec2CloseError: new Error('ec2-close-secret'),
    });
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    const client = /** @type {Record<string, any>} */ (
      authority.createRuntimeIdentityResourceClient()
    );

    const firstClose = client.close();
    expect(client.close()).toBe(firstClose);
    await expect(firstClose).rejects.toThrow(
      'AWS deployment runtime-identity resource client close failed.',
    );
    expect(harness.iamDestroy).toHaveBeenCalledTimes(1);
    expect(harness.ec2Destroy).toHaveBeenCalledTimes(1);
    for (const method of RUNTIME_IDENTITY_RESOURCE_METHODS) {
      await expect(client[method]({})).rejects.toThrow(
        'AWS deployment runtime-identity resource client is closed.',
      );
    }
    await authority.close();
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

  it('closes STS idempotently, leaves every issued client caller-owned, and refuses reuse', async () => {
    const harness = await loadHarness();
    const authority = await harness.createAwsDeploymentAuthority({
      region: 'us-east-1',
    });
    const db = authority.createDynamoDB();
    const controlClient = authority.createDynamoDBControlClient();
    const s3ControlClient = /** @type {Record<string, any>} */ (
      authority.createS3ControlClient()
    );
    const providerSpecReadClient = /** @type {Record<string, any>} */ (
      authority.createProviderSpecReadClient()
    );
    const volumeResourceClient = /** @type {Record<string, any>} */ (
      authority.createVolumeResourceClient()
    );
    const networkResourceClient = /** @type {Record<string, any>} */ (
      authority.createNetworkResourceClient()
    );
    const runtimeIdentityResourceClient = /** @type {Record<string, any>} */ (
      authority.createRuntimeIdentityResourceClient()
    );

    await authority.close();
    await authority.close();
    expect(harness.stsDestroy).toHaveBeenCalledTimes(1);
    expect(harness.documentDestroy).not.toHaveBeenCalled();
    expect(harness.dynamoDestroy).not.toHaveBeenCalled();
    expect(harness.s3Destroy).not.toHaveBeenCalled();
    expect(harness.ssmDestroy).not.toHaveBeenCalled();
    expect(harness.ec2Destroy).not.toHaveBeenCalled();
    expect(harness.iamDestroy).not.toHaveBeenCalled();
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
    expect(() => authority.createProviderSpecReadClient()).toThrow(
      'AWS deployment authority is closed.',
    );
    expect(() => authority.createVolumeResourceClient()).toThrow(
      'AWS deployment authority is closed.',
    );
    expect(() => authority.createNetworkResourceClient()).toThrow(
      'AWS deployment authority is closed.',
    );
    expect(() => authority.createRuntimeIdentityResourceClient()).toThrow(
      'AWS deployment authority is closed.',
    );
    await expect(
      s3ControlClient.headBucket({ Bucket: 'still-caller-owned' }),
    ).resolves.toEqual({});
    await expect(
      providerSpecReadClient.getParameter({ Name: '/still/caller-owned' }),
    ).resolves.toMatchObject({
      Parameter: { Value: 'resolved-parameter' },
    });
    await expect(
      providerSpecReadClient.describeImages({
        ImageIds: ['ami-00000000000000001'],
      }),
    ).resolves.toMatchObject({ Images: [] });
    await expect(
      volumeResourceClient.createVolume({
        AvailabilityZone: 'us-east-1a',
        ClientToken: 'still-caller-owned',
        Size: 8,
      }),
    ).resolves.toMatchObject({ VolumeId: 'vol-00000000000000001' });
    await expect(
      volumeResourceClient.describeVolumes({
        VolumeIds: ['vol-00000000000000001'],
      }),
    ).resolves.toMatchObject({ Volumes: [] });
    await expect(
      networkResourceClient.createVpc({ CidrBlock: '10.42.0.0/16' }),
    ).resolves.toMatchObject({
      Vpc: { VpcId: 'vpc-00000000000000001' },
    });
    await expect(
      networkResourceClient.describeVpcs({
        VpcIds: ['vpc-00000000000000001'],
      }),
    ).resolves.toMatchObject({ Vpcs: [] });
    await expect(
      runtimeIdentityResourceClient.getRole({
        RoleName: 'still-caller-owned',
      }),
    ).resolves.toMatchObject({ operation: 'getRole' });
    await expect(
      runtimeIdentityResourceClient.describeInstances({
        Filters: [
          {
            Name: 'iam-instance-profile.id',
            Values: ['still-caller-owned'],
          },
        ],
      }),
    ).resolves.toMatchObject({ Reservations: [] });

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
    const firstProviderSpecClose = providerSpecReadClient.close();
    expect(providerSpecReadClient.close()).toBe(firstProviderSpecClose);
    await firstProviderSpecClose;
    for (const method of PROVIDER_SPEC_READ_METHODS) {
      await expect(providerSpecReadClient[method]({})).rejects.toThrow(
        'AWS deployment provider-spec read client is closed.',
      );
    }
    const firstVolumeClose = volumeResourceClient.close();
    expect(volumeResourceClient.close()).toBe(firstVolumeClose);
    await firstVolumeClose;
    for (const method of VOLUME_RESOURCE_METHODS) {
      await expect(volumeResourceClient[method]({})).rejects.toThrow(
        'AWS deployment volume resource client is closed.',
      );
    }
    const firstNetworkClose = networkResourceClient.close();
    expect(networkResourceClient.close()).toBe(firstNetworkClose);
    await firstNetworkClose;
    for (const method of NETWORK_RESOURCE_METHODS) {
      await expect(networkResourceClient[method]({})).rejects.toThrow(
        'AWS deployment network resource client is closed.',
      );
    }
    const firstRuntimeIdentityClose = runtimeIdentityResourceClient.close();
    expect(runtimeIdentityResourceClient.close()).toBe(
      firstRuntimeIdentityClose,
    );
    await firstRuntimeIdentityClose;
    for (const method of RUNTIME_IDENTITY_RESOURCE_METHODS) {
      await expect(runtimeIdentityResourceClient[method]({})).rejects.toThrow(
        'AWS deployment runtime-identity resource client is closed.',
      );
    }
    expect(harness.documentDestroy).toHaveBeenCalledTimes(1);
    expect(harness.dynamoDestroy).toHaveBeenCalledTimes(1);
    expect(harness.s3Destroy).toHaveBeenCalledTimes(1);
    expect(harness.ssmDestroy).toHaveBeenCalledTimes(1);
    expect(harness.ec2Destroy).toHaveBeenCalledTimes(4);
    expect(harness.iamDestroy).toHaveBeenCalledTimes(1);
  });
});
