/* eslint-disable jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact internal boundary helpers keep their complete types inline. */

import { DynamoDB } from '@aws-sdk/client-dynamodb';
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
 * capability. Every STS check and DynamoDB adapter issued by the capability
 * uses the same static credential object and explicit region.
 * @param {{region: string}} options - Exact explicit invocation region.
 * @returns {Promise<Readonly<{
 *   providerScope: Readonly<import('./deployment-provider-scope.js').AwsProviderScope>,
 *   resolveScope: () => Promise<Readonly<import('./deployment-provider-scope.js').AwsProviderScope>>,
 *   createDynamoDB: (options?: {readOnly?: boolean}) => import('../lib/db/base.js').DBClient,
 *   createDynamoDBControlClient: () => Readonly<DynamoDBControlClient>,
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
    close,
  });
}

export default { createAwsDeploymentAuthority };
