/* eslint-disable jsdoc/valid-types, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- The narrow injected AWS SDK boundary keeps its complete port protocol beside the implementation. */

import BaseAWS from '../../../lib/aws/base.js';
import { loadAwsProviderBindings } from '../../aws-provider-module.js';
import {
  createAwsProviderScope,
  validateProviderScope,
} from '../../deployment-provider-scope.js';

export const AWS_SINGLE_NODE_OPERATION_AUTHORITY_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_OPERATION_AUTHORITY_KIND =
  'awsSingleNodeOperationAuthority';
export const AWS_SINGLE_NODE_OPERATION_MAX_ATTEMPTS = 1;

const REGION_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/u;
const ACCOUNT_ID_PATTERN = /^[0-9]{12}$/u;
const CALLER_ARN_PATTERN =
  /^arn:(aws(?:-[a-z0-9]+)*):(?:iam|sts)::([0-9]{12}):[!-~]+$/u;
const OPEN_KEYS = new Set(['region']);
const DEPENDENCY_KEYS = new Set([
  'createCredentialProvider',
  'createStsClient',
  'createEc2Client',
]);
const STS_CLIENT_METHODS = new Set(['getCallerIdentity', 'close']);
const EC2_CLIENT_METHODS = new Set([
  'describeSecurityGroups',
  'describeInstanceAttribute',
  'describeInstanceCreditSpecifications',
  'describeInstances',
  'describeVolumes',
  'createSecurityGroup',
  'authorizeSecurityGroupIngress',
  'runInstances',
  'terminateInstances',
  'deleteVolume',
  'deleteSecurityGroup',
  'close',
]);
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

/** STS could not establish one exact account, partition, and region. */
export class AwsSingleNodeOperationScopeResolutionError extends Error {
  constructor() {
    super('AWS single-node operation caller scope resolution failed.');
    this.name = 'AwsSingleNodeOperationScopeResolutionError';
    this.code = 'AWS_SINGLE_NODE_OPERATION_SCOPE_RESOLUTION_FAILED';
  }
}

/** Refreshed ambient credentials no longer identify the bound provider scope. */
export class AwsSingleNodeOperationScopeChangedError extends Error {
  constructor() {
    super('AWS single-node operation caller scope changed.');
    this.name = 'AwsSingleNodeOperationScopeChangedError';
    this.code = 'AWS_SINGLE_NODE_OPERATION_SCOPE_CHANGED';
  }
}

/** A credential-bound read failed without exposing the raw SDK failure. */
export class AwsSingleNodeOperationReadError extends Error {
  /** @param {string} operation */
  constructor(operation) {
    super(`AWS single-node operation read '${operation}' failed.`);
    this.name = 'AwsSingleNodeOperationReadError';
    this.code = 'AWS_SINGLE_NODE_OPERATION_READ_FAILED';
    this.operation = operation;
  }
}

/** A scope-checked mutation failed without exposing the raw SDK failure. */
export class AwsSingleNodeOperationMutationError extends Error {
  /** @param {string} operation */
  constructor(operation) {
    super(`AWS single-node mutation '${operation}' failed.`);
    this.name = 'AwsSingleNodeOperationMutationError';
    this.code = 'AWS_SINGLE_NODE_OPERATION_MUTATION_FAILED';
    this.operation = operation;
  }
}

/** Credential provider or client construction failed. */
export class AwsSingleNodeOperationAuthorityInitializationError extends Error {
  constructor() {
    super('AWS single-node operation authority initialization failed.');
    this.name = 'AwsSingleNodeOperationAuthorityInitializationError';
    this.code = 'AWS_SINGLE_NODE_OPERATION_AUTHORITY_INITIALIZATION_FAILED';
  }
}

/** One or more credential-owning SDK clients could not be closed. */
export class AwsSingleNodeOperationAuthorityCloseError extends Error {
  constructor() {
    super('AWS single-node operation authority close failed.');
    this.name = 'AwsSingleNodeOperationAuthorityCloseError';
    this.code = 'AWS_SINGLE_NODE_OPERATION_AUTHORITY_CLOSE_FAILED';
  }
}

/** The operation authority has already relinquished its clients. */
export class AwsSingleNodeOperationAuthorityClosedError extends Error {
  constructor() {
    super('AWS single-node operation authority is closed.');
    this.name = 'AwsSingleNodeOperationAuthorityClosedError';
    this.code = 'AWS_SINGLE_NODE_OPERATION_AUTHORITY_CLOSED';
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
      'awsSingleNodeOperationAuthority.region must be a canonical explicit AWS region.',
    );
  }
  return value;
}

/**
 * Decode only the secret-free scope fields from STS.
 * @param {unknown} value
 * @param {string} region
 * @returns {Readonly<Record<string, any>>}
 */
function scopeFromCallerIdentity(value, region) {
  if (!isPlainObject(value)) {
    throw new AwsSingleNodeOperationScopeResolutionError();
  }
  const identity = /** @type {Record<string, any>} */ (value);
  if (
    typeof identity.Account !== 'string' ||
    !ACCOUNT_ID_PATTERN.test(identity.Account) ||
    typeof identity.Arn !== 'string' ||
    identity.Arn.length > 2048
  ) {
    throw new AwsSingleNodeOperationScopeResolutionError();
  }
  const match = CALLER_ARN_PATTERN.exec(identity.Arn);
  if (match === null || match[2] !== identity.Account) {
    throw new AwsSingleNodeOperationScopeResolutionError();
  }
  try {
    return createAwsProviderScope({
      partition: match[1],
      accountId: identity.Account,
      region,
    });
  } catch {
    throw new AwsSingleNodeOperationScopeResolutionError();
  }
}

/**
 * Copy an exact injected client without granting methods a receiver containing
 * sibling capabilities.
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
    result[method] = object[method];
  }
  return Object.freeze(result);
}

/**
 * Close every constructed client in reverse ownership order, retaining only a
 * fixed failure.
 * @param {Readonly<Record<string, Function>>[]} clients
 * @returns {Promise<void>}
 */
async function closeClients(clients) {
  let failed = false;
  for (const client of [...clients].reverse()) {
    try {
      await Reflect.apply(client.close, undefined, []);
    } catch {
      failed = true;
    }
  }
  if (failed) throw new AwsSingleNodeOperationAuthorityCloseError();
}

/**
 * Invoke an injected constructor without a receiver that could expose sibling
 * dependencies.
 * @param {Function} capability
 * @param {unknown} value
 * @returns {Promise<unknown>}
 */
async function construct(capability, value) {
  return await Reflect.apply(capability, undefined, [value]);
}

/**
 * Build a testable refreshable operation authority factory.
 * @param {unknown} dependencies
 * @returns {(options: unknown) => Promise<Readonly<Record<string, any>>>}
 */
export function createAwsSingleNodeOperationAuthorityFactory(dependencies) {
  const provided = exactDataObject(
    dependencies,
    DEPENDENCY_KEYS,
    'awsSingleNodeOperationAuthority dependencies',
  );
  /** @type {Record<string, Function>} */
  const ports = {};
  for (const key of DEPENDENCY_KEYS) {
    if (typeof provided[key] !== 'function') {
      throw new TypeError(
        `awsSingleNodeOperationAuthority dependency ${key} must be a function.`,
      );
    }
    ports[key] = provided[key];
  }

  return async function open(value) {
    const options = exactDataObject(
      value,
      OPEN_KEYS,
      'awsSingleNodeOperationAuthority',
    );
    const region = canonicalRegion(options.region);
    /** @type {unknown} */
    let credentialProvider;
    try {
      credentialProvider = Reflect.apply(
        ports.createCredentialProvider,
        undefined,
        [{ region }],
      );
    } catch {
      throw new AwsSingleNodeOperationAuthorityInitializationError();
    }
    if (typeof credentialProvider !== 'function') {
      throw new AwsSingleNodeOperationAuthorityInitializationError();
    }

    /** @type {Readonly<Record<string, Function>>[]} */
    const constructed = [];
    /** @type {Readonly<Record<string, Function>>} */
    let sts;
    /** @type {Readonly<Record<string, Function>>} */
    let ec2;
    try {
      sts = validateClient(
        await construct(ports.createStsClient, {
          region,
          credentials: credentialProvider,
        }),
        STS_CLIENT_METHODS,
        'awsSingleNodeOperationAuthority.stsClient',
      );
      constructed.push(sts);

      let identity;
      try {
        identity = await Reflect.apply(sts.getCallerIdentity, undefined, [{}]);
      } catch {
        throw new AwsSingleNodeOperationScopeResolutionError();
      }
      const providerScope = scopeFromCallerIdentity(identity, region);

      ec2 = validateClient(
        await construct(ports.createEc2Client, {
          region,
          credentials: credentialProvider,
          maxAttempts: AWS_SINGLE_NODE_OPERATION_MAX_ATTEMPTS,
        }),
        EC2_CLIENT_METHODS,
        'awsSingleNodeOperationAuthority.ec2Client',
      );
      constructed.push(ec2);

      let closed = false;
      /** @type {Promise<void>|undefined} */
      let closePromise;

      /** @returns {void} */
      function assertOpen() {
        if (closed) throw new AwsSingleNodeOperationAuthorityClosedError();
      }

      /** @returns {Promise<Readonly<Record<string, any>>>} */
      async function resolveScope() {
        assertOpen();
        let observed;
        try {
          observed = await Reflect.apply(sts.getCallerIdentity, undefined, [
            {},
          ]);
        } catch {
          throw new AwsSingleNodeOperationScopeResolutionError();
        }
        const scope = scopeFromCallerIdentity(observed, region);
        if (scope.providerScopeId !== providerScope.providerScopeId) {
          throw new AwsSingleNodeOperationScopeChangedError();
        }
        return validateProviderScope(scope);
      }

      /**
       * @param {string} method
       * @param {unknown} request
       * @returns {Promise<unknown>}
       */
      async function read(method, request) {
        assertOpen();
        try {
          return await Reflect.apply(ec2[method], undefined, [request]);
        } catch {
          throw new AwsSingleNodeOperationReadError(method);
        }
      }

      /**
       * @param {string} method
       * @param {unknown} request
       * @returns {Promise<unknown>}
       */
      async function mutate(method, request) {
        await resolveScope();
        assertOpen();
        try {
          return await Reflect.apply(ec2[method], undefined, [request]);
        } catch {
          throw new AwsSingleNodeOperationMutationError(method);
        }
      }

      /** @type {Record<string, Function>} */
      const api = {};
      for (const method of READ_METHODS) {
        api[method] = async (/** @type {unknown} */ request) =>
          await read(method, request);
      }
      for (const method of MUTATION_METHODS) {
        api[method] = async (/** @type {unknown} */ request) =>
          await mutate(method, request);
      }

      return Object.freeze({
        schemaVersion: AWS_SINGLE_NODE_OPERATION_AUTHORITY_SCHEMA_VERSION,
        kind: AWS_SINGLE_NODE_OPERATION_AUTHORITY_KIND,
        providerScope,
        api: Object.freeze(api),
        resolveScope,
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
          throw new AwsSingleNodeOperationAuthorityInitializationError();
        }
      }
      if (error instanceof AwsSingleNodeOperationScopeResolutionError) {
        throw error;
      }
      throw new AwsSingleNodeOperationAuthorityInitializationError();
    }
  };
}

/**
 * Adapt one SDK client to an exact own-data operation port.
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
    AuthorizeSecurityGroupIngressCommand,
    CreateSecurityGroupCommand,
    DeleteSecurityGroupCommand,
    DeleteVolumeCommand,
    DescribeInstanceAttributeCommand,
    DescribeInstanceCreditSpecificationsCommand,
    DescribeInstancesCommand,
    DescribeSecurityGroupsCommand,
    DescribeVolumesCommand,
    EC2Client,
    RunInstancesCommand,
    TerminateInstancesCommand,
  } = bindings.clientEC2;
  const { GetCallerIdentityCommand, STSClient } = bindings.clientSTS;
  const { fromNodeProviderChain } = bindings.credentialProviders;

  return createAwsSingleNodeOperationAuthorityFactory({
    createCredentialProvider(/** @type {{region: string}} */ value) {
      return fromNodeProviderChain({
        clientConfig: { region: value.region },
      });
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
        ...BaseAWS.config({ maxAttempts: value.maxAttempts }, bindings),
        maxAttempts: value.maxAttempts,
        region: value.region,
        credentials: value.credentials,
      });
      return sdkPort(sdk, {
        describeSecurityGroups: DescribeSecurityGroupsCommand,
        describeInstanceAttribute: DescribeInstanceAttributeCommand,
        describeInstanceCreditSpecifications:
          DescribeInstanceCreditSpecificationsCommand,
        describeInstances: DescribeInstancesCommand,
        describeVolumes: DescribeVolumesCommand,
        createSecurityGroup: CreateSecurityGroupCommand,
        authorizeSecurityGroupIngress: AuthorizeSecurityGroupIngressCommand,
        runInstances: RunInstancesCommand,
        terminateInstances: TerminateInstancesCommand,
        deleteVolume: DeleteVolumeCommand,
        deleteSecurityGroup: DeleteSecurityGroupCommand,
      });
    },
  });
}

/**
 * Open the production operation authority through one ordinary refreshable
 * Node AWS credential provider shared unchanged by STS and EC2.
 * @param {unknown} options
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function createAwsSingleNodeOperationAuthority(options) {
  const bindings = await loadAwsProviderBindings();
  return await createProductionOpen(bindings)(options);
}

export default {
  AWS_SINGLE_NODE_OPERATION_AUTHORITY_KIND,
  AWS_SINGLE_NODE_OPERATION_AUTHORITY_SCHEMA_VERSION,
  AWS_SINGLE_NODE_OPERATION_MAX_ATTEMPTS,
  AwsSingleNodeOperationAuthorityCloseError,
  AwsSingleNodeOperationAuthorityClosedError,
  AwsSingleNodeOperationAuthorityInitializationError,
  AwsSingleNodeOperationMutationError,
  AwsSingleNodeOperationReadError,
  AwsSingleNodeOperationScopeChangedError,
  AwsSingleNodeOperationScopeResolutionError,
  createAwsSingleNodeOperationAuthority,
  createAwsSingleNodeOperationAuthorityFactory,
};
