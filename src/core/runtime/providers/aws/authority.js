/* eslint-disable jsdoc/valid-types, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- The narrow injected AWS SDK boundary keeps its complete port protocol beside the implementation. */

import BaseAWS from '../../../lib/aws/base.js';
import { loadAwsProviderBindings } from '../../aws-provider-module.js';
import {
  createAwsProviderScope,
  validateProviderScope,
} from '../../deployment-provider-scope.js';

export const AWS_SINGLE_NODE_READ_AUTHORITY_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_READ_AUTHORITY_KIND = 'awsSingleNodeReadAuthority';

const REGION_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/u;
const ACCOUNT_ID_PATTERN = /^[0-9]{12}$/u;
const CALLER_ARN_PATTERN =
  /^arn:(aws(?:-[a-z0-9]+)*):(?:iam|sts)::([0-9]{12}):[!-~]+$/u;
const OPEN_KEYS = new Set(['region']);
const DEPENDENCY_KEYS = new Set([
  'resolveCredentials',
  'createStsClient',
  'createEc2Client',
]);
const STS_CLIENT_METHODS = new Set(['getCallerIdentity', 'close']);
const EC2_CLIENT_METHODS = new Set([
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
  'close',
]);
const READ_METHODS = Object.freeze([
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
]);

/** Ambient AWS credentials could not be resolved through the ordinary chain. */
export class AwsSingleNodeCredentialResolutionError extends Error {
  constructor() {
    super('AWS single-node ambient credential resolution failed.');
    this.name = 'AwsSingleNodeCredentialResolutionError';
    this.code = 'AWS_SINGLE_NODE_CREDENTIAL_RESOLUTION_FAILED';
  }
}

/** STS could not establish one exact account, partition, and region. */
export class AwsSingleNodeScopeResolutionError extends Error {
  constructor() {
    super('AWS single-node caller scope resolution failed.');
    this.name = 'AwsSingleNodeScopeResolutionError';
    this.code = 'AWS_SINGLE_NODE_SCOPE_RESOLUTION_FAILED';
  }
}

/** A credential-bound read failed without exposing the raw SDK failure. */
export class AwsSingleNodeReadError extends Error {
  /**
   * @param {string} operation - Fixed provider operation name.
   */
  constructor(operation) {
    super(`AWS single-node read '${operation}' failed.`);
    this.name = 'AwsSingleNodeReadError';
    this.code = 'AWS_SINGLE_NODE_READ_FAILED';
    this.operation = operation;
  }
}

/** Credential-bound client construction failed. */
export class AwsSingleNodeAuthorityInitializationError extends Error {
  constructor() {
    super('AWS single-node read authority initialization failed.');
    this.name = 'AwsSingleNodeAuthorityInitializationError';
    this.code = 'AWS_SINGLE_NODE_AUTHORITY_INITIALIZATION_FAILED';
  }
}

/** One or more credential-owning SDK clients could not be closed. */
export class AwsSingleNodeAuthorityCloseError extends Error {
  constructor() {
    super('AWS single-node read authority close failed.');
    this.name = 'AwsSingleNodeAuthorityCloseError';
    this.code = 'AWS_SINGLE_NODE_AUTHORITY_CLOSE_FAILED';
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

/**
 * Require an exact enumerable own-data object.
 * @param {unknown} value
 * @param {Set<string>} keys
 * @param {string} valuePath
 * @returns {Record<string, any>}
 */
function exactDataObject(value, keys, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  const ownKeys = Reflect.ownKeys(object);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(`${valuePath} fields are invalid.`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an own data field.`);
    }
  }
  return object;
}

/** @param {unknown} value @returns {string} */
function canonicalRegion(value) {
  if (
    typeof value !== 'string' ||
    value.length > 63 ||
    !REGION_PATTERN.test(value)
  ) {
    throw new TypeError(
      'awsSingleNodeReadAuthority.region must be a canonical explicit AWS region.',
    );
  }
  return value;
}

/**
 * Copy only SDK credential identity fields into one immutable capability that
 * never crosses the returned authority boundary.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
function credentialSnapshot(value) {
  if (!isPlainObject(value)) {
    throw new AwsSingleNodeCredentialResolutionError();
  }
  const candidate = /** @type {Record<string, any>} */ (value);
  if (
    typeof candidate.accessKeyId !== 'string' ||
    candidate.accessKeyId.length === 0 ||
    typeof candidate.secretAccessKey !== 'string' ||
    candidate.secretAccessKey.length === 0 ||
    (candidate.sessionToken !== undefined &&
      (typeof candidate.sessionToken !== 'string' ||
        candidate.sessionToken.length === 0)) ||
    (candidate.expiration !== undefined &&
      (!(candidate.expiration instanceof Date) ||
        !Number.isFinite(candidate.expiration.getTime())))
  ) {
    throw new AwsSingleNodeCredentialResolutionError();
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
 * Decode only the secret-free scope fields from STS.
 * @param {unknown} value
 * @param {string} region
 * @returns {Readonly<Record<string, any>>}
 */
function scopeFromCallerIdentity(value, region) {
  if (!isPlainObject(value)) {
    throw new AwsSingleNodeScopeResolutionError();
  }
  const identity = /** @type {Record<string, any>} */ (value);
  if (
    typeof identity.Account !== 'string' ||
    !ACCOUNT_ID_PATTERN.test(identity.Account) ||
    typeof identity.Arn !== 'string' ||
    identity.Arn.length > 2048
  ) {
    throw new AwsSingleNodeScopeResolutionError();
  }
  const match = CALLER_ARN_PATTERN.exec(identity.Arn);
  if (match === null || match[2] !== identity.Account) {
    throw new AwsSingleNodeScopeResolutionError();
  }
  try {
    return createAwsProviderScope({
      partition: match[1],
      accountId: identity.Account,
      region,
    });
  } catch {
    throw new AwsSingleNodeScopeResolutionError();
  }
}

/**
 * Validate one injected SDK client without touching inherited or accessor
 * capabilities.
 * @param {unknown} value
 * @param {Set<string>} methods
 * @param {string} valuePath
 * @returns {Readonly<Record<string, Function>>}
 */
function validateClient(value, methods, valuePath) {
  const object = exactDataObject(value, methods, valuePath);
  /** @type {Record<string, Function>} */
  const result = {};
  for (const method of methods) {
    if (typeof object[method] !== 'function') {
      throw new TypeError(`${valuePath}.${method} must be a function.`);
    }
    result[method] = object[method].bind(object);
  }
  return Object.freeze(result);
}

/**
 * Close every constructed client, retaining only a fixed failure.
 * @param {Readonly<Record<string, Function>>[]} clients
 * @returns {Promise<void>}
 */
async function closeClients(clients) {
  const outcomes = await Promise.allSettled(
    [...clients].reverse().map(async (client) => await client.close()),
  );
  if (outcomes.some((outcome) => outcome.status === 'rejected')) {
    throw new AwsSingleNodeAuthorityCloseError();
  }
}

/**
 * Build a testable credential-owning read authority factory.
 * @param {unknown} dependencies
 * @returns {(options: unknown) => Promise<Readonly<Record<string, any>>>}
 */
export function createAwsSingleNodeReadAuthorityFactory(dependencies) {
  const provided = exactDataObject(
    dependencies,
    DEPENDENCY_KEYS,
    'awsSingleNodeReadAuthority dependencies',
  );
  /** @type {Record<string, Function>} */
  const ports = {};
  for (const key of DEPENDENCY_KEYS) {
    if (typeof provided[key] !== 'function') {
      throw new TypeError(
        `awsSingleNodeReadAuthority dependency ${key} must be a function.`,
      );
    }
    ports[key] = provided[key];
  }

  return async function open(value) {
    const options = exactDataObject(
      value,
      OPEN_KEYS,
      'awsSingleNodeReadAuthority',
    );
    const region = canonicalRegion(options.region);
    let resolvedCredentials;
    try {
      resolvedCredentials = await ports.resolveCredentials({ region });
    } catch {
      throw new AwsSingleNodeCredentialResolutionError();
    }
    const credentials = credentialSnapshot(resolvedCredentials);
    const credentialProvider = async () => credentials;
    /** @type {Readonly<Record<string, Function>>[]} */
    const constructed = [];
    /** @type {Readonly<Record<string, Function>>} */
    let sts;
    /** @type {Readonly<Record<string, Function>>} */
    let ec2;
    try {
      sts = validateClient(
        await ports.createStsClient({
          region,
          credentials: credentialProvider,
        }),
        STS_CLIENT_METHODS,
        'awsSingleNodeReadAuthority.stsClient',
      );
      constructed.push(sts);
      let identity;
      try {
        identity = await sts.getCallerIdentity({});
      } catch {
        throw new AwsSingleNodeScopeResolutionError();
      }
      const providerScope = scopeFromCallerIdentity(identity, region);
      ec2 = validateClient(
        await ports.createEc2Client({
          region,
          credentials: credentialProvider,
        }),
        EC2_CLIENT_METHODS,
        'awsSingleNodeReadAuthority.ec2Client',
      );
      constructed.push(ec2);

      let closed = false;
      /** @type {Promise<void>|undefined} */
      let closePromise;

      /** @returns {void} */
      function assertOpen() {
        if (closed) {
          throw new Error('AWS single-node read authority is closed.');
        }
      }

      /**
       * @param {Readonly<Record<string, Function>>} client
       * @param {string} method
       * @param {unknown} request
       * @returns {Promise<unknown>}
       */
      async function read(client, method, request) {
        assertOpen();
        try {
          return await client[method](request);
        } catch {
          throw new AwsSingleNodeReadError(method);
        }
      }

      /** @type {Record<string, Function>} */
      const api = {};
      for (const method of READ_METHODS) {
        api[method] = async (/** @type {unknown} */ request) =>
          await read(ec2, method, request);
      }

      return Object.freeze({
        schemaVersion: AWS_SINGLE_NODE_READ_AUTHORITY_SCHEMA_VERSION,
        kind: AWS_SINGLE_NODE_READ_AUTHORITY_KIND,
        providerScope,
        api: Object.freeze(api),
        async resolveScope() {
          assertOpen();
          let observed;
          try {
            observed = await sts.getCallerIdentity({});
          } catch {
            throw new AwsSingleNodeScopeResolutionError();
          }
          const scope = scopeFromCallerIdentity(observed, region);
          if (scope.providerScopeId !== providerScope.providerScopeId) {
            throw new AwsSingleNodeScopeResolutionError();
          }
          return validateProviderScope(scope);
        },
        close() {
          if (closePromise !== undefined) return closePromise;
          closed = true;
          closePromise = closeClients(constructed);
          return closePromise;
        },
      });
    } catch (error) {
      if (constructed.length > 0) {
        try {
          await closeClients(constructed);
        } catch {
          throw new AwsSingleNodeAuthorityInitializationError();
        }
      }
      if (
        error instanceof AwsSingleNodeScopeResolutionError ||
        error instanceof AwsSingleNodeCredentialResolutionError
      ) {
        throw error;
      }
      throw new AwsSingleNodeAuthorityInitializationError();
    }
  };
}

/**
 * @param {{send(command: unknown): Promise<unknown>, destroy(): void}} sdk
 * @param {Readonly<Record<string, new (input: any) => any>>} commands
 * @returns {Readonly<Record<string, Function>>}
 */
function sdkPort(sdk, commands) {
  /** @type {Record<string, Function>} */
  const result = {};
  for (const [method, Command] of Object.entries(commands)) {
    result[method] = async (/** @type {unknown} */ input) =>
      await sdk.send(new Command(input));
  }
  result.close = async () => {
    sdk.destroy();
  };
  return Object.freeze(result);
}

/**
 * Bind the production authority only after the version-matched companion has
 * supplied and validated its SDK namespaces.
 * @param {import('../../aws-provider-module.js').AwsSdkBindings} bindings - Fixed provider bindings.
 * @returns {(options: unknown) => Promise<Readonly<Record<string, any>>>} - Production authority opener.
 */
function createProductionOpen(bindings) {
  const {
    DescribeImagesCommand,
    DescribeInstanceAttributeCommand,
    DescribeInstanceCreditSpecificationsCommand,
    DescribeInstanceTypeOfferingsCommand,
    DescribeInstancesCommand,
    DescribeInternetGatewaysCommand,
    DescribeNetworkAclsCommand,
    DescribeRouteTablesCommand,
    DescribeSecurityGroupsCommand,
    DescribeSubnetsCommand,
    DescribeVolumesCommand,
    DescribeVpcsCommand,
    EC2Client,
  } = bindings.clientEC2;
  const { GetCallerIdentityCommand, STSClient } = bindings.clientSTS;
  const { fromNodeProviderChain } = bindings.credentialProviders;

  return createAwsSingleNodeReadAuthorityFactory({
    async resolveCredentials(/** @type {{region: string}} */ value) {
      return await fromNodeProviderChain({
        clientConfig: { region: value.region },
      })();
    },
    createStsClient(/** @type {Record<string, any>} */ value) {
      const sdk = new STSClient({
        ...BaseAWS.config({ maxAttempts: 3 }, bindings),
        region: value.region,
        credentials: value.credentials,
      });
      return sdkPort(sdk, {
        getCallerIdentity: GetCallerIdentityCommand,
      });
    },
    createEc2Client(/** @type {Record<string, any>} */ value) {
      const sdk = new EC2Client({
        ...BaseAWS.config({ maxAttempts: 3 }, bindings),
        region: value.region,
        credentials: value.credentials,
      });
      return sdkPort(sdk, {
        describeImages: DescribeImagesCommand,
        describeInstanceAttribute: DescribeInstanceAttributeCommand,
        describeInstanceCreditSpecifications:
          DescribeInstanceCreditSpecificationsCommand,
        describeInstanceTypeOfferings: DescribeInstanceTypeOfferingsCommand,
        describeInstances: DescribeInstancesCommand,
        describeInternetGateways: DescribeInternetGatewaysCommand,
        describeNetworkAcls: DescribeNetworkAclsCommand,
        describeRouteTables: DescribeRouteTablesCommand,
        describeSecurityGroups: DescribeSecurityGroupsCommand,
        describeSubnets: DescribeSubnetsCommand,
        describeVolumes: DescribeVolumesCommand,
        describeVpcs: DescribeVpcsCommand,
      });
    },
  });
}

/**
 * Open the production read authority through the ordinary Node AWS credential
 * chain. Credentials remain private to the invocation.
 * @param {unknown} options
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function createAwsSingleNodeReadAuthority(options) {
  const bindings = await loadAwsProviderBindings();
  return await createProductionOpen(bindings)(options);
}

export default {
  AWS_SINGLE_NODE_READ_AUTHORITY_KIND,
  AWS_SINGLE_NODE_READ_AUTHORITY_SCHEMA_VERSION,
  AwsSingleNodeAuthorityCloseError,
  AwsSingleNodeAuthorityInitializationError,
  AwsSingleNodeCredentialResolutionError,
  AwsSingleNodeReadError,
  AwsSingleNodeScopeResolutionError,
  createAwsSingleNodeReadAuthority,
  createAwsSingleNodeReadAuthorityFactory,
};
