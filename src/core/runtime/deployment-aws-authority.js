/* eslint-disable jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact internal boundary helpers keep their complete types inline. */

import { DynamoDB } from '@aws-sdk/client-dynamodb';
import {
  AttachInternetGatewayCommand,
  CreateInternetGatewayCommand,
  CreateSubnetCommand,
  CreateVpcCommand,
  CreateVolumeCommand,
  DeleteInternetGatewayCommand,
  DeleteSubnetCommand,
  DeleteVpcCommand,
  DescribeAvailabilityZonesCommand,
  DescribeImagesCommand,
  DescribeInternetGatewaysCommand,
  DescribeInstanceTypeOfferingsCommand,
  DescribeSubnetsCommand,
  DescribeVpcAttributeCommand,
  DescribeVpcsCommand,
  DescribeVolumesCommand,
  DetachInternetGatewayCommand,
  EC2Client,
  GetEbsDefaultKmsKeyIdCommand,
} from '@aws-sdk/client-ec2';
import { S3 } from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from '../lib/aws/base.js';
import createDynamoDBAdapter from '../lib/db/adapters/dynamodb.js';
import { createAwsProviderScope } from './deployment-provider-scope.js';

const AWS_REGION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const AWS_CALLER_ARN_PATTERN =
  /^arn:(aws(?:-[a-z0-9]+)*):(?:iam|sts)::([0-9]{12}):[!-~]+$/;
const FACTORY_KEYS = new Set(['region']);
const DYNAMODB_FACTORY_KEYS = new Set(['readOnly']);

const INVALID_OPTIONS_ERROR =
  'AWS deployment authority options must contain only one explicit region.';
const INVALID_REGION_ERROR =
  'AWS deployment authority region must be canonical.';
const CREDENTIAL_RESOLUTION_ERROR =
  'AWS deployment credential resolution failed.';
const INVALID_CREDENTIALS_ERROR =
  'AWS deployment credential resolution returned an invalid identity.';
const CALLER_IDENTITY_ERROR = 'AWS caller identity resolution failed.';
const INVALID_CALLER_IDENTITY_ERROR =
  'AWS caller identity response is invalid.';
const CALLER_IDENTITY_MISMATCH_ERROR =
  'AWS caller identity response is internally inconsistent.';
const CALLER_IDENTITY_CHANGED_ERROR =
  'AWS caller identity changed during the deployment invocation.';
const CLOSED_ERROR = 'AWS deployment authority is closed.';
const CLOSE_ERROR = 'AWS deployment authority close failed.';
const INITIALIZATION_ERROR = 'AWS deployment authority initialization failed.';
const DYNAMODB_CREATION_ERROR = 'AWS deployment DynamoDB creation failed.';
const DYNAMODB_CONTROL_CLOSED_ERROR =
  'AWS deployment DynamoDB control client is closed.';
const DYNAMODB_CONTROL_CLOSE_ERROR =
  'AWS deployment DynamoDB control client close failed.';
const S3_CONTROL_CREATION_ERROR =
  'AWS deployment S3 control client creation failed.';
const S3_CONTROL_OPERATION_ERROR =
  'AWS deployment S3 control operation failed.';
const S3_CONTROL_CLOSED_ERROR = 'AWS deployment S3 control client is closed.';
const S3_CONTROL_CLOSE_ERROR = 'AWS deployment S3 control client close failed.';
const PROVIDER_SPEC_READ_CREATION_ERROR =
  'AWS deployment provider-spec read client creation failed.';
const PROVIDER_SPEC_READ_OPERATION_ERROR =
  'AWS deployment provider-spec read operation failed.';
const PROVIDER_SPEC_READ_CLOSED_ERROR =
  'AWS deployment provider-spec read client is closed.';
const PROVIDER_SPEC_READ_CLOSE_ERROR =
  'AWS deployment provider-spec read client close failed.';
const VOLUME_RESOURCE_CREATION_ERROR =
  'AWS deployment volume resource client creation failed.';
const VOLUME_RESOURCE_OPERATION_ERROR =
  'AWS deployment volume resource operation failed.';
const VOLUME_RESOURCE_CLOSED_ERROR =
  'AWS deployment volume resource client is closed.';
const VOLUME_RESOURCE_CLOSE_ERROR =
  'AWS deployment volume resource client close failed.';
const NETWORK_RESOURCE_CREATION_ERROR =
  'AWS deployment network resource client creation failed.';
const NETWORK_RESOURCE_OPERATION_ERROR =
  'AWS deployment network resource operation failed.';
const NETWORK_RESOURCE_CLOSED_ERROR =
  'AWS deployment network resource client is closed.';
const NETWORK_RESOURCE_CLOSE_ERROR =
  'AWS deployment network resource client close failed.';
const PROVIDER_SPEC_READ_ERROR_NAMES = new Set([
  'ParameterNotFound',
  'ParameterVersionNotFound',
]);
const VOLUME_RESOURCE_ERROR_NAMES = new Set([
  'IdempotentParameterMismatch',
  'InvalidVolume.NotFound',
]);
const NETWORK_RESOURCE_ERROR_NAMES = new Set([
  'DependencyViolation',
  'Gateway.NotAttached',
  'IncorrectState',
  'InvalidInternetGatewayID.NotFound',
  'InvalidSubnetID.NotFound',
  'InvalidSubnetId.NotFound',
  'InvalidVpcID.NotFound',
  'Resource.AlreadyAssociated',
]);
const S3_CONTROL_ERROR_NAMES = new Set([
  'ConditionalRequestConflict',
  'NoSuchBucket',
  'NoSuchKey',
  'NoSuchLifecycleConfiguration',
  'NoSuchBucketPolicy',
  'NoSuchOwnershipControls',
  'NoSuchPublicAccessBlockConfiguration',
  'NoSuchTagSet',
  'NoSuchVersion',
  'NotFound',
  'OwnershipControlsNotFoundError',
  'PreconditionFailed',
  'ReplicationConfigurationNotFoundError',
  'ServerSideEncryptionConfigurationNotFoundError',
]);

/**
 * @typedef DynamoDBControlClient
 * @property {(input: import('@aws-sdk/client-dynamodb').CreateTableCommandInput) => Promise<any>} createTable - Create one exact table.
 * @property {(input: import('@aws-sdk/client-dynamodb').DescribeContinuousBackupsCommandInput) => Promise<any>} describeContinuousBackups - Read backup state.
 * @property {(input: import('@aws-sdk/client-dynamodb').DescribeTableCommandInput) => Promise<any>} describeTable - Read table state.
 * @property {(input: import('@aws-sdk/client-dynamodb').DescribeTimeToLiveCommandInput) => Promise<any>} describeTimeToLive - Read TTL state.
 * @property {(input: import('@aws-sdk/client-dynamodb').ListTagsOfResourceCommandInput) => Promise<any>} listTagsOfResource - Read table tags.
 * @property {(input: import('@aws-sdk/client-dynamodb').UpdateContinuousBackupsCommandInput) => Promise<any>} updateContinuousBackups - Strengthen backup state.
 * @property {() => Promise<void>} close - Close the caller-owned SDK client.
 */

/**
 * @typedef NetworkResourceClient
 * @property {(input: import('@aws-sdk/client-ec2').AttachInternetGatewayCommandInput) => Promise<any>} attachInternetGateway - Attach one exact internet gateway to one exact VPC.
 * @property {(input: import('@aws-sdk/client-ec2').CreateInternetGatewayCommandInput) => Promise<any>} createInternetGateway - Create one exact internet gateway.
 * @property {(input: import('@aws-sdk/client-ec2').CreateSubnetCommandInput) => Promise<any>} createSubnet - Create one exact subnet.
 * @property {(input: import('@aws-sdk/client-ec2').CreateVpcCommandInput) => Promise<any>} createVpc - Create one exact VPC.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeInternetGatewaysCommandInput) => Promise<any>} describeInternetGateways - Read exact internet-gateway state.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeSubnetsCommandInput) => Promise<any>} describeSubnets - Read exact subnet state.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeVpcsCommandInput) => Promise<any>} describeVpcs - Read exact VPC state.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeVpcAttributeCommandInput) => Promise<any>} describeVpcAttribute - Read one exact VPC attribute.
 * @property {(input: import('@aws-sdk/client-ec2').DetachInternetGatewayCommandInput) => Promise<any>} detachInternetGateway - Detach one exact internet gateway from one exact VPC.
 * @property {(input: import('@aws-sdk/client-ec2').DeleteInternetGatewayCommandInput) => Promise<any>} deleteInternetGateway - Delete one exact internet gateway.
 * @property {(input: import('@aws-sdk/client-ec2').DeleteSubnetCommandInput) => Promise<any>} deleteSubnet - Delete one exact subnet.
 * @property {(input: import('@aws-sdk/client-ec2').DeleteVpcCommandInput) => Promise<any>} deleteVpc - Delete one exact VPC.
 * @property {() => Promise<void>} close - Close the caller-owned SDK client.
 */

/**
 * @typedef ProviderSpecReadClient
 * @property {(input: import('@aws-sdk/client-ssm').GetParameterCommandInput) => Promise<any>} getParameter - Read one exact parameter.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeAvailabilityZonesCommandInput) => Promise<any>} describeAvailabilityZones - Resolve regional availability-zone metadata.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeImagesCommandInput) => Promise<any>} describeImages - Resolve exact image metadata.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeInstanceTypeOfferingsCommandInput) => Promise<any>} describeInstanceTypeOfferings - Resolve exact regional instance-type offerings.
 * @property {(input: import('@aws-sdk/client-ec2').GetEbsDefaultKmsKeyIdCommandInput) => Promise<any>} getEbsDefaultKmsKeyId - Resolve the account's regional default EBS KMS key.
 * @property {() => Promise<void>} close - Close both caller-owned SDK clients.
 */

/**
 * @typedef VolumeResourceClient
 * @property {(input: import('@aws-sdk/client-ec2').CreateVolumeCommandInput) => Promise<any>} createVolume - Create one exact EBS volume.
 * @property {(input: import('@aws-sdk/client-ec2').DescribeVolumesCommandInput) => Promise<any>} describeVolumes - Read exact EBS volume state.
 * @property {() => Promise<void>} close - Close the caller-owned SDK client.
 */

/**
 * @typedef S3ControlClient
 * @property {(input: import('@aws-sdk/client-s3').CreateBucketCommandInput) => Promise<any>} createBucket - Create one exact bucket.
 * @property {(input: import('@aws-sdk/client-s3').HeadBucketCommandInput) => Promise<any>} headBucket - Read bucket existence and access.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketEncryptionCommandInput) => Promise<any>} getBucketEncryption - Read encryption state.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketLifecycleConfigurationCommandInput) => Promise<any>} getBucketLifecycleConfiguration - Read lifecycle state.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketLocationCommandInput) => Promise<any>} getBucketLocation - Read bucket location.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketOwnershipControlsCommandInput) => Promise<any>} getBucketOwnershipControls - Read ownership controls.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketPolicyCommandInput) => Promise<any>} getBucketPolicy - Read bucket-policy state.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketReplicationCommandInput) => Promise<any>} getBucketReplication - Read replication state.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketTaggingCommandInput) => Promise<any>} getBucketTagging - Read bucket tags.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketVersioningCommandInput) => Promise<any>} getBucketVersioning - Read versioning state.
 * @property {(input: import('@aws-sdk/client-s3').GetPublicAccessBlockCommandInput) => Promise<any>} getPublicAccessBlock - Read public-access state.
 * @property {(input: import('@aws-sdk/client-s3').GetObjectCommandInput) => Promise<any>} getObject - Read one exact object.
 * @property {(input: import('@aws-sdk/client-s3').PutBucketEncryptionCommandInput) => Promise<any>} putBucketEncryption - Set exact encryption state.
 * @property {(input: import('@aws-sdk/client-s3').PutBucketLifecycleConfigurationCommandInput) => Promise<any>} putBucketLifecycleConfiguration - Set exact lifecycle state.
 * @property {(input: import('@aws-sdk/client-s3').PutBucketOwnershipControlsCommandInput) => Promise<any>} putBucketOwnershipControls - Set exact ownership controls.
 * @property {(input: import('@aws-sdk/client-s3').PutBucketVersioningCommandInput) => Promise<any>} putBucketVersioning - Set exact versioning state.
 * @property {(input: import('@aws-sdk/client-s3').PutPublicAccessBlockCommandInput) => Promise<any>} putPublicAccessBlock - Set exact public-access state.
 * @property {(input: import('@aws-sdk/client-s3').PutObjectCommandInput) => Promise<any>} putObject - Put one exact object.
 * @property {(input: import('@aws-sdk/client-s3').HeadObjectCommandInput) => Promise<any>} headObject - Read exact object metadata.
 * @property {() => Promise<void>} close - Close the caller-owned SDK client.
 */

/**
 * @typedef CredentialSnapshot
 * @property {string} accessKeyId - AWS access-key identity.
 * @property {string} secretAccessKey - AWS signing secret.
 * @property {string} [sessionToken] - Temporary-session token.
 * @property {Date} [expiration] - Temporary-credential expiration.
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Preserve only the provider classifications required for authoritative
 * readback. Raw SDK messages, request IDs, credential-bearing configuration,
 * and causes never cross the narrow authority boundary.
 * @param {unknown} value - Raw SDK failure.
 * @returns {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} - Sanitized classified failure.
 */
function sanitizeS3ControlError(value) {
  const candidate =
    value !== null && typeof value === 'object'
      ? /** @type {Record<string, any>} */ (value)
      : {};
  const error =
    /** @type {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} */ (
      new Error(S3_CONTROL_OPERATION_ERROR)
    );
  error.name = S3_CONTROL_ERROR_NAMES.has(candidate.name)
    ? candidate.name
    : 'AwsDeploymentS3ControlError';
  error.code = 'AWS_DEPLOYMENT_S3_CONTROL_OPERATION';
  const status = candidate.$metadata?.httpStatusCode;
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    error.$metadata = Object.freeze({ httpStatusCode: status });
  }
  return error;
}

/**
 * Preserve only the SSM missing classifications required by the provider-spec
 * resolver. Raw SDK messages, request IDs, access classifications, causes,
 * and credential-bearing configuration never cross this boundary.
 * @param {unknown} value - Raw SDK failure.
 * @returns {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} - Sanitized classified failure.
 */
function sanitizeProviderSpecReadError(value) {
  const candidate =
    value !== null && typeof value === 'object'
      ? /** @type {Record<string, any>} */ (value)
      : {};
  const error =
    /** @type {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} */ (
      new Error(PROVIDER_SPEC_READ_OPERATION_ERROR)
    );
  error.name = PROVIDER_SPEC_READ_ERROR_NAMES.has(candidate.name)
    ? candidate.name
    : 'AwsDeploymentProviderSpecReadError';
  error.code = 'AWS_DEPLOYMENT_PROVIDER_SPEC_READ_OPERATION';
  const status = candidate.$metadata?.httpStatusCode;
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    error.$metadata = Object.freeze({ httpStatusCode: status });
  }
  return error;
}

/**
 * Preserve only the EBS classifications required for safe idempotent create
 * and authoritative readback. Raw SDK messages, request IDs, access
 * classifications, causes, and credential-bearing configuration never cross
 * this boundary.
 * @param {unknown} value - Raw SDK failure.
 * @returns {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} - Sanitized classified failure.
 */
function sanitizeVolumeResourceError(value) {
  const candidate =
    value !== null && typeof value === 'object'
      ? /** @type {Record<string, any>} */ (value)
      : {};
  const error =
    /** @type {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} */ (
      new Error(VOLUME_RESOURCE_OPERATION_ERROR)
    );
  error.name = VOLUME_RESOURCE_ERROR_NAMES.has(candidate.name)
    ? candidate.name
    : 'AwsDeploymentVolumeResourceError';
  error.code = 'AWS_DEPLOYMENT_VOLUME_RESOURCE_OPERATION';
  const status = candidate.$metadata?.httpStatusCode;
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    error.$metadata = Object.freeze({ httpStatusCode: status });
  }
  return error;
}

/**
 * Preserve only the network-resource classifications needed for authoritative
 * absence and dependency-fenced deletion. Raw SDK messages, request IDs,
 * access details, causes, and credential-bearing configuration never cross
 * this boundary.
 * @param {unknown} value - Raw SDK failure.
 * @returns {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} - Sanitized classified failure.
 */
function sanitizeNetworkResourceError(value) {
  const candidate =
    value !== null && typeof value === 'object'
      ? /** @type {Record<string, any>} */ (value)
      : {};
  const error =
    /** @type {Error & {code: string, $metadata?: Readonly<{httpStatusCode: number}>}} */ (
      new Error(NETWORK_RESOURCE_OPERATION_ERROR)
    );
  error.name = NETWORK_RESOURCE_ERROR_NAMES.has(candidate.name)
    ? candidate.name
    : 'AwsDeploymentNetworkResourceError';
  error.code = 'AWS_DEPLOYMENT_NETWORK_RESOURCE_OPERATION';
  const status = candidate.$metadata?.httpStatusCode;
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    error.$metadata = Object.freeze({ httpStatusCode: status });
  }
  return error;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @returns {boolean} */
function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return (
    actual.length === keys.size &&
    actual.every((key) => keys.has(key)) &&
    [...keys].every((key) => Object.hasOwn(value, key))
  );
}

/** @param {unknown} options @returns {string} */
function readCanonicalRegion(options) {
  if (!isPlainObject(options) || !hasExactKeys(options, FACTORY_KEYS)) {
    throw new TypeError(INVALID_OPTIONS_ERROR);
  }
  const { region } = options;
  if (
    typeof region !== 'string' ||
    region.length > 63 ||
    !AWS_REGION_PATTERN.test(region)
  ) {
    throw new TypeError(INVALID_REGION_ERROR);
  }
  return region;
}

/** @param {unknown} value @returns {value is string} */
function isNonemptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Copy only SDK credential identity fields into one immutable, non-refreshing
 * value. Nothing returned by this module exposes the snapshot.
 * @param {unknown} value - Resolved ordinary-chain credential identity.
 * @returns {Readonly<CredentialSnapshot>} - Static credentials.
 */
function createCredentialSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(INVALID_CREDENTIALS_ERROR);
  }
  const candidate = /** @type {Record<string, any>} */ (value);
  if (
    !isNonemptyString(candidate.accessKeyId) ||
    !isNonemptyString(candidate.secretAccessKey) ||
    (candidate.sessionToken !== undefined &&
      !isNonemptyString(candidate.sessionToken)) ||
    (candidate.expiration !== undefined &&
      (!(candidate.expiration instanceof Date) ||
        !Number.isFinite(candidate.expiration.getTime())))
  ) {
    throw new TypeError(INVALID_CREDENTIALS_ERROR);
  }

  return Object.freeze({
    accessKeyId: candidate.accessKeyId,
    secretAccessKey: candidate.secretAccessKey,
    ...(candidate.sessionToken === undefined
      ? {}
      : { sessionToken: candidate.sessionToken }),
    ...(candidate.expiration === undefined
      ? {}
      : { expiration: new Date(candidate.expiration.getTime()) }),
  });
}

/**
 * @param {unknown} value - GetCallerIdentity response.
 * @param {string} region - Explicit invocation region.
 * @returns {Readonly<import('./deployment-provider-scope.js').AwsProviderScope>} - Redacted scope.
 */
function scopeFromCallerIdentity(value, region) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(INVALID_CALLER_IDENTITY_ERROR);
  }
  const identity = /** @type {Record<string, any>} */ (value);
  const accountId = identity.Account;
  const arn = identity.Arn;
  if (
    typeof accountId !== 'string' ||
    !AWS_ACCOUNT_ID_PATTERN.test(accountId) ||
    typeof arn !== 'string' ||
    arn.length > 2048
  ) {
    throw new Error(INVALID_CALLER_IDENTITY_ERROR);
  }
  const match = AWS_CALLER_ARN_PATTERN.exec(arn);
  if (!match) throw new Error(INVALID_CALLER_IDENTITY_ERROR);
  const [, partition, arnAccountId] = match;
  if (arnAccountId !== accountId) {
    throw new Error(CALLER_IDENTITY_MISMATCH_ERROR);
  }
  return createAwsProviderScope({ partition, accountId, region });
}

/**
 * Resolve one invocation's ordinary AWS credentials into a non-exposed
 * capability. Every STS check and DynamoDB, S3, SSM, or EC2 client issued by
 * the capability uses the same static credential object and explicit region.
 * @param {{region: string}} options - Exact explicit invocation region.
 * @returns {Promise<Readonly<{
 *   providerScope: Readonly<import('./deployment-provider-scope.js').AwsProviderScope>,
 *   resolveScope: () => Promise<Readonly<import('./deployment-provider-scope.js').AwsProviderScope>>,
 *   createDynamoDB: (options?: {readOnly?: boolean}) => import('../lib/db/base.js').DBClient,
 *   createDynamoDBControlClient: () => Readonly<DynamoDBControlClient>,
 *   createS3ControlClient: () => Readonly<S3ControlClient>,
 *   createProviderSpecReadClient: () => Readonly<ProviderSpecReadClient>,
 *   createVolumeResourceClient: () => Readonly<VolumeResourceClient>,
 *   createNetworkResourceClient: () => Readonly<NetworkResourceClient>,
 *   close: () => Promise<void>,
 * }>>} - Credential-bound AWS authority.
 */
export async function createAwsDeploymentAuthority(options) {
  const region = readCanonicalRegion(options);
  let resolvedCredentials;
  try {
    const provider = fromNodeProviderChain({ clientConfig: { region } });
    resolvedCredentials = await provider();
  } catch {
    throw new Error(CREDENTIAL_RESOLUTION_ERROR);
  }
  /** @type {Readonly<CredentialSnapshot>} */
  let credentials;
  try {
    credentials = createCredentialSnapshot(resolvedCredentials);
  } catch {
    throw new TypeError(INVALID_CREDENTIALS_ERROR);
  }

  /** @type {STSClient} */
  let sts;
  try {
    sts = new STSClient({
      ...BaseAWS.config(),
      region,
      credentials,
    });
  } catch {
    throw new Error(INITIALIZATION_ERROR);
  }
  let closed = false;
  /** @type {Readonly<import('./deployment-provider-scope.js').AwsProviderScope> | undefined} */
  let providerScope;

  /** @returns {void} */
  function assertOpen() {
    if (closed) throw new Error(CLOSED_ERROR);
  }

  /** @returns {Promise<Readonly<import('./deployment-provider-scope.js').AwsProviderScope>>} */
  async function resolveScope() {
    assertOpen();
    let identity;
    try {
      identity = await sts.send(new GetCallerIdentityCommand({}));
    } catch {
      throw new Error(CALLER_IDENTITY_ERROR);
    }
    const scope = scopeFromCallerIdentity(identity, region);
    if (
      providerScope !== undefined &&
      scope.providerScopeId !== providerScope.providerScopeId
    ) {
      throw new Error(CALLER_IDENTITY_CHANGED_ERROR);
    }
    return scope;
  }

  try {
    providerScope = await resolveScope();
  } catch (error) {
    try {
      sts.destroy();
    } catch {
      // The identity error is the useful fixed boundary failure.
    }
    throw error;
  }

  /** @param {{readOnly?: boolean}} [dbOptions] @returns {import('../lib/db/base.js').DBClient} */
  function createDynamoDB(dbOptions = {}) {
    assertOpen();
    if (
      !isPlainObject(dbOptions) ||
      Object.keys(dbOptions).some((key) => !DYNAMODB_FACTORY_KEYS.has(key)) ||
      (dbOptions.readOnly !== undefined &&
        typeof dbOptions.readOnly !== 'boolean')
    ) {
      throw new TypeError('AWS deployment DynamoDB options are invalid.');
    }
    try {
      return createDynamoDBAdapter({
        region,
        credentials,
        readOnly: dbOptions.readOnly ?? false,
      });
    } catch {
      throw new Error(DYNAMODB_CREATION_ERROR);
    }
  }

  /** @returns {Readonly<DynamoDBControlClient>} - Caller-owned narrow control-plane client. */
  function createDynamoDBControlClient() {
    assertOpen();
    /** @type {DynamoDB} */
    let client;
    try {
      client = new DynamoDB({
        ...BaseAWS.config(),
        region,
        credentials,
      });
    } catch {
      throw new Error(DYNAMODB_CREATION_ERROR);
    }
    let clientClosed = false;

    /** @param {() => Promise<any>} operation @returns {Promise<any>} */
    function call(operation) {
      if (clientClosed) throw new Error(DYNAMODB_CONTROL_CLOSED_ERROR);
      return operation();
    }

    return Object.freeze({
      createTable: (
        /** @type {import('@aws-sdk/client-dynamodb').CreateTableCommandInput} */ input,
      ) => call(() => client.createTable(input)),
      describeContinuousBackups: (
        /** @type {import('@aws-sdk/client-dynamodb').DescribeContinuousBackupsCommandInput} */ input,
      ) => call(() => client.describeContinuousBackups(input)),
      describeTable: (
        /** @type {import('@aws-sdk/client-dynamodb').DescribeTableCommandInput} */ input,
      ) => call(() => client.describeTable(input)),
      describeTimeToLive: (
        /** @type {import('@aws-sdk/client-dynamodb').DescribeTimeToLiveCommandInput} */ input,
      ) => call(() => client.describeTimeToLive(input)),
      listTagsOfResource: (
        /** @type {import('@aws-sdk/client-dynamodb').ListTagsOfResourceCommandInput} */ input,
      ) => call(() => client.listTagsOfResource(input)),
      updateContinuousBackups: (
        /** @type {import('@aws-sdk/client-dynamodb').UpdateContinuousBackupsCommandInput} */ input,
      ) => call(() => client.updateContinuousBackups(input)),
      close: async () => {
        if (clientClosed) return;
        clientClosed = true;
        try {
          client.destroy();
        } catch {
          throw new Error(DYNAMODB_CONTROL_CLOSE_ERROR);
        }
      },
    });
  }

  /** @returns {Readonly<S3ControlClient>} - Caller-owned narrow control-plane client. */
  function createS3ControlClient() {
    assertOpen();
    /** @type {S3} */
    let client;
    try {
      client = new S3({
        ...BaseAWS.config(),
        region,
        credentials,
      });
    } catch {
      throw new Error(S3_CONTROL_CREATION_ERROR);
    }
    let clientClosed = false;
    /** @type {Promise<void> | undefined} */
    let closePromise;

    /** @param {() => Promise<any>} operation @returns {Promise<any>} */
    async function call(operation) {
      if (clientClosed) throw new Error(S3_CONTROL_CLOSED_ERROR);
      // Lifecycle and staging consumers must distinguish authoritative AWS
      // outcomes such as NoSuchBucket, NoSuchLifecycleConfiguration, and a
      // conditional PutObject collision. Preserve only those allowlisted
      // classifications while stripping the raw provider failure.
      try {
        return await operation();
      } catch (error) {
        throw sanitizeS3ControlError(error);
      }
    }

    /** @returns {Promise<void>} */
    function closeClient() {
      if (closePromise) return closePromise;
      clientClosed = true;
      closePromise = (async () => {
        try {
          client.destroy();
        } catch {
          throw new Error(S3_CONTROL_CLOSE_ERROR);
        }
      })();
      return closePromise;
    }

    return Object.freeze({
      createBucket: (
        /** @type {import('@aws-sdk/client-s3').CreateBucketCommandInput} */ input,
      ) => call(() => client.createBucket(input)),
      headBucket: (
        /** @type {import('@aws-sdk/client-s3').HeadBucketCommandInput} */ input,
      ) => call(() => client.headBucket(input)),
      getBucketEncryption: (
        /** @type {import('@aws-sdk/client-s3').GetBucketEncryptionCommandInput} */ input,
      ) => call(() => client.getBucketEncryption(input)),
      getBucketLifecycleConfiguration: (
        /** @type {import('@aws-sdk/client-s3').GetBucketLifecycleConfigurationCommandInput} */ input,
      ) => call(() => client.getBucketLifecycleConfiguration(input)),
      getBucketLocation: (
        /** @type {import('@aws-sdk/client-s3').GetBucketLocationCommandInput} */ input,
      ) => call(() => client.getBucketLocation(input)),
      getBucketOwnershipControls: (
        /** @type {import('@aws-sdk/client-s3').GetBucketOwnershipControlsCommandInput} */ input,
      ) => call(() => client.getBucketOwnershipControls(input)),
      getBucketPolicy: (
        /** @type {import('@aws-sdk/client-s3').GetBucketPolicyCommandInput} */ input,
      ) => call(() => client.getBucketPolicy(input)),
      getBucketReplication: (
        /** @type {import('@aws-sdk/client-s3').GetBucketReplicationCommandInput} */ input,
      ) => call(() => client.getBucketReplication(input)),
      getBucketTagging: (
        /** @type {import('@aws-sdk/client-s3').GetBucketTaggingCommandInput} */ input,
      ) => call(() => client.getBucketTagging(input)),
      getBucketVersioning: (
        /** @type {import('@aws-sdk/client-s3').GetBucketVersioningCommandInput} */ input,
      ) => call(() => client.getBucketVersioning(input)),
      getPublicAccessBlock: (
        /** @type {import('@aws-sdk/client-s3').GetPublicAccessBlockCommandInput} */ input,
      ) => call(() => client.getPublicAccessBlock(input)),
      getObject: (
        /** @type {import('@aws-sdk/client-s3').GetObjectCommandInput} */ input,
      ) => call(() => client.getObject(input)),
      putBucketEncryption: (
        /** @type {import('@aws-sdk/client-s3').PutBucketEncryptionCommandInput} */ input,
      ) => call(() => client.putBucketEncryption(input)),
      putBucketLifecycleConfiguration: (
        /** @type {import('@aws-sdk/client-s3').PutBucketLifecycleConfigurationCommandInput} */ input,
      ) => call(() => client.putBucketLifecycleConfiguration(input)),
      putBucketOwnershipControls: (
        /** @type {import('@aws-sdk/client-s3').PutBucketOwnershipControlsCommandInput} */ input,
      ) => call(() => client.putBucketOwnershipControls(input)),
      putBucketVersioning: (
        /** @type {import('@aws-sdk/client-s3').PutBucketVersioningCommandInput} */ input,
      ) => call(() => client.putBucketVersioning(input)),
      putPublicAccessBlock: (
        /** @type {import('@aws-sdk/client-s3').PutPublicAccessBlockCommandInput} */ input,
      ) => call(() => client.putPublicAccessBlock(input)),
      putObject: (
        /** @type {import('@aws-sdk/client-s3').PutObjectCommandInput} */ input,
      ) => call(() => client.putObject(input)),
      headObject: (
        /** @type {import('@aws-sdk/client-s3').HeadObjectCommandInput} */ input,
      ) => call(() => client.headObject(input)),
      close: closeClient,
    });
  }

  /** @returns {Readonly<ProviderSpecReadClient>} - Caller-owned narrow provider-spec read client. */
  function createProviderSpecReadClient() {
    assertOpen();
    /** @type {SSMClient | undefined} */
    let ssm;
    /** @type {EC2Client | undefined} */
    let ec2;
    try {
      ssm = new SSMClient({
        ...BaseAWS.config(),
        region,
        credentials,
      });
      ec2 = new EC2Client({
        ...BaseAWS.config(),
        region,
        credentials,
      });
    } catch {
      try {
        ssm?.destroy();
      } catch {
        // Construction failure remains the fixed boundary error.
      }
      try {
        ec2?.destroy();
      } catch {
        // Construction failure remains the fixed boundary error.
      }
      throw new Error(PROVIDER_SPEC_READ_CREATION_ERROR);
    }
    if (ssm === undefined || ec2 === undefined) {
      throw new Error(PROVIDER_SPEC_READ_CREATION_ERROR);
    }
    const ssmClient = ssm;
    const ec2Client = ec2;
    let clientClosed = false;
    /** @type {Promise<void> | undefined} */
    let closePromise;

    /** @param {() => Promise<any>} operation @returns {Promise<any>} */
    async function call(operation) {
      if (clientClosed) throw new Error(PROVIDER_SPEC_READ_CLOSED_ERROR);
      try {
        return await operation();
      } catch (error) {
        throw sanitizeProviderSpecReadError(error);
      }
    }

    /** @returns {Promise<void>} */
    function closeClient() {
      if (closePromise) return closePromise;
      clientClosed = true;
      closePromise = (async () => {
        let failed = false;
        try {
          ssmClient.destroy();
        } catch {
          failed = true;
        }
        try {
          ec2Client.destroy();
        } catch {
          failed = true;
        }
        if (failed) throw new Error(PROVIDER_SPEC_READ_CLOSE_ERROR);
      })();
      return closePromise;
    }

    return Object.freeze({
      getParameter: (
        /** @type {import('@aws-sdk/client-ssm').GetParameterCommandInput} */ input,
      ) => call(() => ssmClient.send(new GetParameterCommand(input))),
      describeAvailabilityZones: (
        /** @type {import('@aws-sdk/client-ec2').DescribeAvailabilityZonesCommandInput} */ input,
      ) =>
        call(() => ec2Client.send(new DescribeAvailabilityZonesCommand(input))),
      describeImages: (
        /** @type {import('@aws-sdk/client-ec2').DescribeImagesCommandInput} */ input,
      ) => call(() => ec2Client.send(new DescribeImagesCommand(input))),
      describeInstanceTypeOfferings: (
        /** @type {import('@aws-sdk/client-ec2').DescribeInstanceTypeOfferingsCommandInput} */ input,
      ) =>
        call(() =>
          ec2Client.send(new DescribeInstanceTypeOfferingsCommand(input)),
        ),
      getEbsDefaultKmsKeyId: (
        /** @type {import('@aws-sdk/client-ec2').GetEbsDefaultKmsKeyIdCommandInput} */ input,
      ) => call(() => ec2Client.send(new GetEbsDefaultKmsKeyIdCommand(input))),
      close: closeClient,
    });
  }

  /** @returns {Readonly<VolumeResourceClient>} - Caller-owned narrow EBS resource client. */
  function createVolumeResourceClient() {
    assertOpen();
    /** @type {EC2Client} */
    let client;
    try {
      client = new EC2Client({
        ...BaseAWS.config(),
        region,
        credentials,
      });
    } catch {
      throw new Error(VOLUME_RESOURCE_CREATION_ERROR);
    }
    let clientClosed = false;
    /** @type {Promise<void> | undefined} */
    let closePromise;

    /** @param {() => Promise<any>} operation @returns {Promise<any>} */
    async function call(operation) {
      if (clientClosed) throw new Error(VOLUME_RESOURCE_CLOSED_ERROR);
      try {
        return await operation();
      } catch (error) {
        throw sanitizeVolumeResourceError(error);
      }
    }

    /** @returns {Promise<void>} */
    function closeClient() {
      if (closePromise) return closePromise;
      clientClosed = true;
      closePromise = (async () => {
        try {
          client.destroy();
        } catch {
          throw new Error(VOLUME_RESOURCE_CLOSE_ERROR);
        }
      })();
      return closePromise;
    }

    return Object.freeze({
      createVolume: (
        /** @type {import('@aws-sdk/client-ec2').CreateVolumeCommandInput} */ input,
      ) => call(() => client.send(new CreateVolumeCommand(input))),
      describeVolumes: (
        /** @type {import('@aws-sdk/client-ec2').DescribeVolumesCommandInput} */ input,
      ) => call(() => client.send(new DescribeVolumesCommand(input))),
      close: closeClient,
    });
  }

  /** @returns {Readonly<NetworkResourceClient>} - Caller-owned narrow network resource client. */
  function createNetworkResourceClient() {
    assertOpen();
    /** @type {EC2Client} */
    let client;
    try {
      client = new EC2Client({
        // These network mutations have no provider idempotency token. Keep SDK
        // transport retries from multiplying one authorized effect; each
        // driver owns explicit recovery through exact readback.
        ...BaseAWS.config({ maxAttempts: 1 }),
        region,
        credentials,
      });
    } catch {
      throw new Error(NETWORK_RESOURCE_CREATION_ERROR);
    }
    let clientClosed = false;
    /** @type {Promise<void> | undefined} */
    let closePromise;

    /** @param {() => Promise<any>} operation @returns {Promise<any>} */
    async function call(operation) {
      if (clientClosed) throw new Error(NETWORK_RESOURCE_CLOSED_ERROR);
      try {
        return await operation();
      } catch (error) {
        throw sanitizeNetworkResourceError(error);
      }
    }

    /** @returns {Promise<void>} */
    function closeClient() {
      if (closePromise) return closePromise;
      clientClosed = true;
      closePromise = (async () => {
        try {
          client.destroy();
        } catch {
          throw new Error(NETWORK_RESOURCE_CLOSE_ERROR);
        }
      })();
      return closePromise;
    }

    return Object.freeze({
      attachInternetGateway: (
        /** @type {import('@aws-sdk/client-ec2').AttachInternetGatewayCommandInput} */ input,
      ) => call(() => client.send(new AttachInternetGatewayCommand(input))),
      createInternetGateway: (
        /** @type {import('@aws-sdk/client-ec2').CreateInternetGatewayCommandInput} */ input,
      ) => call(() => client.send(new CreateInternetGatewayCommand(input))),
      createSubnet: (
        /** @type {import('@aws-sdk/client-ec2').CreateSubnetCommandInput} */ input,
      ) => call(() => client.send(new CreateSubnetCommand(input))),
      createVpc: (
        /** @type {import('@aws-sdk/client-ec2').CreateVpcCommandInput} */ input,
      ) => call(() => client.send(new CreateVpcCommand(input))),
      describeInternetGateways: (
        /** @type {import('@aws-sdk/client-ec2').DescribeInternetGatewaysCommandInput} */ input,
      ) => call(() => client.send(new DescribeInternetGatewaysCommand(input))),
      describeSubnets: (
        /** @type {import('@aws-sdk/client-ec2').DescribeSubnetsCommandInput} */ input,
      ) => call(() => client.send(new DescribeSubnetsCommand(input))),
      describeVpcs: (
        /** @type {import('@aws-sdk/client-ec2').DescribeVpcsCommandInput} */ input,
      ) => call(() => client.send(new DescribeVpcsCommand(input))),
      describeVpcAttribute: (
        /** @type {import('@aws-sdk/client-ec2').DescribeVpcAttributeCommandInput} */ input,
      ) => call(() => client.send(new DescribeVpcAttributeCommand(input))),
      detachInternetGateway: (
        /** @type {import('@aws-sdk/client-ec2').DetachInternetGatewayCommandInput} */ input,
      ) => call(() => client.send(new DetachInternetGatewayCommand(input))),
      deleteInternetGateway: (
        /** @type {import('@aws-sdk/client-ec2').DeleteInternetGatewayCommandInput} */ input,
      ) => call(() => client.send(new DeleteInternetGatewayCommand(input))),
      deleteSubnet: (
        /** @type {import('@aws-sdk/client-ec2').DeleteSubnetCommandInput} */ input,
      ) => call(() => client.send(new DeleteSubnetCommand(input))),
      deleteVpc: (
        /** @type {import('@aws-sdk/client-ec2').DeleteVpcCommandInput} */ input,
      ) => call(() => client.send(new DeleteVpcCommand(input))),
      close: closeClient,
    });
  }

  /** @returns {Promise<void>} */
  async function close() {
    if (closed) return;
    closed = true;
    try {
      sts.destroy();
    } catch {
      throw new Error(CLOSE_ERROR);
    }
  }

  return Object.freeze({
    providerScope,
    resolveScope,
    createDynamoDB,
    createDynamoDBControlClient,
    createS3ControlClient,
    createProviderSpecReadClient,
    createVolumeResourceClient,
    createNetworkResourceClient,
    close,
  });
}

export default { createAwsDeploymentAuthority };
