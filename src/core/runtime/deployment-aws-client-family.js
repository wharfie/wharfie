/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This boundary owns a heterogeneous family of already-narrow AWS capabilities. */

import { createAwsDeploymentAuthority } from './deployment-aws-authority.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import { brandDBClient, DB_ADAPTER_NAMES } from '../lib/db/base.js';

const AUTHORITY_KEYS = new Set([
  'providerScope',
  'resolveScope',
  'createDynamoDB',
  'createDynamoDBControlClient',
  'createS3ControlClient',
  'createManagedArtifactResourceClient',
  'createProviderSpecReadClient',
  'createVolumeResourceClient',
  'createNodeResourceClient',
  'createVolumeAttachmentResourceClient',
  'createNetworkResourceClient',
  'createRuntimeIdentityResourceClient',
  'close',
]);
const AUTHORITY_METHOD_KEYS = new Set(
  [...AUTHORITY_KEYS].filter((key) => key !== 'providerScope'),
);
const OPEN_OPTIONS_KEYS = new Set(['region']);
const CLIENT_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: 'deploymentStore',
    factory: 'createDynamoDB',
  }),
  Object.freeze({
    key: 'dynamoControl',
    factory: 'createDynamoDBControlClient',
  }),
  Object.freeze({
    key: 's3Control',
    factory: 'createS3ControlClient',
  }),
  Object.freeze({
    key: 'providerSpecRead',
    factory: 'createProviderSpecReadClient',
  }),
  Object.freeze({
    key: 'managedArtifact',
    factory: 'createManagedArtifactResourceClient',
  }),
  Object.freeze({
    key: 'volume',
    factory: 'createVolumeResourceClient',
  }),
  Object.freeze({
    key: 'network',
    factory: 'createNetworkResourceClient',
  }),
  Object.freeze({
    key: 'runtimeIdentity',
    factory: 'createRuntimeIdentityResourceClient',
  }),
  Object.freeze({
    key: 'node',
    factory: 'createNodeResourceClient',
  }),
  Object.freeze({
    key: 'volumeAttachment',
    factory: 'createVolumeAttachmentResourceClient',
  }),
]);
/** @type {Readonly<Record<string, readonly string[]>>} */
const CLIENT_METHODS = Object.freeze({
  deploymentStore: Object.freeze([
    'query',
    'queryPage',
    'batchWrite',
    'transactionWrite',
    'update',
    'put',
    'get',
    'remove',
    'close',
  ]),
  dynamoControl: Object.freeze([
    'createTable',
    'describeContinuousBackups',
    'describeTable',
    'describeTimeToLive',
    'listTagsOfResource',
    'updateContinuousBackups',
    'close',
  ]),
  s3Control: Object.freeze([
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
    'close',
  ]),
  providerSpecRead: Object.freeze([
    'getParameter',
    'describeAvailabilityZones',
    'describeImages',
    'describeInstanceTypeOfferings',
    'getEbsDefaultKmsKeyId',
    'close',
  ]),
  managedArtifact: Object.freeze([
    'copyObject',
    'headObject',
    'listObjectVersions',
    'deleteObjectVersion',
    'close',
  ]),
  volume: Object.freeze(['createVolume', 'describeVolumes', 'close']),
  network: Object.freeze([
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
    'close',
  ]),
  runtimeIdentity: Object.freeze([
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
    'close',
  ]),
  node: Object.freeze([
    'runInstances',
    'startInstances',
    'describeInstances',
    'describeInstanceAttribute',
    'describeInstanceCreditSpecifications',
    'describeVolumes',
    'terminateInstances',
    'close',
  ]),
  volumeAttachment: Object.freeze([
    'attachVolume',
    'detachVolume',
    'modifyInstanceAttribute',
    'describeInstances',
    'describeVolumes',
    'close',
  ]),
});

const INVALID_AUTHORITY_ERROR =
  'AWS deployment client family authority is invalid.';
const INVALID_OPTIONS_ERROR =
  'AWS deployment client family options must contain only one explicit region.';
const INITIALIZATION_ERROR =
  'AWS deployment client family initialization failed.';
const CLOSE_ERROR = 'AWS deployment client family close failed.';
const CLOSED_ERROR = 'AWS deployment client family is closed.';

/** One fixed redacted failure for client-family construction after ownership transfer. */
export class AwsDeploymentClientFamilyInitializationError extends Error {
  constructor() {
    super(INITIALIZATION_ERROR);
    this.name = 'AwsDeploymentClientFamilyInitializationError';
    this.code = 'AWS_DEPLOYMENT_CLIENT_FAMILY_INITIALIZATION_FAILED';
  }
}

/** One fixed redacted failure for best-effort client-family shutdown. */
export class AwsDeploymentClientFamilyCloseError extends Error {
  constructor() {
    super(CLOSE_ERROR);
    this.name = 'AwsDeploymentClientFamilyCloseError';
    this.code = 'AWS_DEPLOYMENT_CLIENT_FAMILY_CLOSE_FAILED';
  }
}

/**
 * @typedef AwsDeploymentClientMap
 * @property {object} deploymentStore - Branded DynamoDB data client.
 * @property {object} dynamoControl - DynamoDB control client.
 * @property {object} s3Control - S3 control client.
 * @property {object} providerSpecRead - Provider-spec reader.
 * @property {object} managedArtifact - Managed-artifact client.
 * @property {object} volume - Volume client.
 * @property {object} network - Network client.
 * @property {object} runtimeIdentity - Runtime-identity client.
 * @property {object} node - Node client.
 * @property {object} volumeAttachment - Volume-attachment client.
 */

/** @type {WeakSet<object>} */
const CLAIMED_AUTHORITIES = new WeakSet();

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Reject inherited, accessor-backed, hidden, or extra authority capabilities.
 * The real authority is a frozen plain object with exactly this data surface.
 * @param {unknown} value - Candidate credential-bound authority.
 * @returns {{authority: Record<string, any>, providerScope: Readonly<import('./deployment-provider-scope.js').AwsProviderScope>}} - Exact authority and canonical scope.
 */
function validateAuthority(value) {
  if (!isPlainObject(value)) throw new TypeError(INVALID_AUTHORITY_ERROR);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== AUTHORITY_KEYS.size ||
    ownKeys.some((key) => typeof key !== 'string' || !AUTHORITY_KEYS.has(key))
  ) {
    throw new TypeError(INVALID_AUTHORITY_ERROR);
  }
  for (const key of AUTHORITY_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(INVALID_AUTHORITY_ERROR);
    }
  }
  for (const key of AUTHORITY_METHOD_KEYS) {
    if (typeof value[key] !== 'function') {
      throw new TypeError(INVALID_AUTHORITY_ERROR);
    }
  }
  let providerScope;
  try {
    providerScope = validateProviderScope(
      value.providerScope,
      'awsDeploymentClientFamily scope',
    );
  } catch {
    throw new TypeError(INVALID_AUTHORITY_ERROR);
  }
  return { authority: value, providerScope };
}

/**
 * Capture one owned method before construction begins.
 * @param {Record<string, any>} owner - Capability owner.
 * @param {string} method - Exact own method.
 * @returns {Function} - Captured implementation.
 */
function captureMethod(owner, method) {
  return owner[method];
}

/**
 * Capture one issued child's exact close capability.
 * @param {unknown} client - Issued child.
 * @returns {{owner: object, close: Function, closePromise?: Promise<unknown>}} - Owned close target.
 */
function captureCloseTarget(client) {
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new Error(INITIALIZATION_ERROR);
  }
  const descriptor = Object.getOwnPropertyDescriptor(client, 'close');
  if (
    !descriptor ||
    !Object.hasOwn(descriptor, 'value') ||
    typeof descriptor.value !== 'function'
  ) {
    throw new Error(INITIALIZATION_ERROR);
  }
  return {
    owner: client,
    close: descriptor.value,
  };
}

/**
 * Memoize one close attempt while turning synchronous throws and arbitrary
 * Promise-like returns into a Promise.
 * @param {{owner: object, close: Function, closePromise?: Promise<unknown>}} target - Captured close target.
 * @returns {Promise<unknown>} - One close attempt.
 */
function invokeClose(target) {
  if (target.closePromise) return target.closePromise;
  try {
    target.closePromise = Promise.resolve(
      Reflect.apply(target.close, target.owner, []),
    );
  } catch (error) {
    target.closePromise = Promise.reject(error);
  }
  return target.closePromise;
}

/**
 * Fence and narrow one issued raw child without changing receiver, arguments,
 * synchronous throws, return values, or Promise identity.
 * @param {string} clientKey - Exact family client key.
 * @param {object} owner - Raw client owner retained only for cleanup.
 * @param {{owner: object, close: Function, closePromise?: Promise<unknown>}} closeTarget - Memoized raw close.
 * @param {() => void} assertFamilyOpen - Shared family lifecycle fence.
 * @returns {Readonly<Record<string, Function>>} - Exact projected client.
 */
function projectClient(clientKey, owner, closeTarget, assertFamilyOpen) {
  const methods = CLIENT_METHODS[clientKey];
  /** @type {Record<string, Function>} */
  const implementations = {};
  for (const method of methods) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, method);
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    ) {
      throw new Error(INITIALIZATION_ERROR);
    }
    implementations[method] = descriptor.value;
  }

  /** @type {Record<string, Function>} */
  const projected = {};
  for (const method of methods) {
    if (method === 'close') {
      projected[method] = () => invokeClose(closeTarget);
      continue;
    }
    /** @type {(...args: any[]) => any} */
    const delegate = (...args) => {
      assertFamilyOpen();
      if (closeTarget.closePromise) throw new Error(CLOSED_ERROR);
      return Reflect.apply(implementations[method], owner, args);
    };
    projected[method] = delegate;
  }
  if (clientKey === 'deploymentStore') {
    brandDBClient(projected, DB_ADAPTER_NAMES.DYNAMODB);
  }
  return Object.freeze(projected);
}

/**
 * Close children in reverse acquisition order, wait for every result, and only
 * then close the authority.
 * @param {Array<{owner: object, close: Function, closePromise?: Promise<unknown>}>} children - Issued children.
 * @param {{owner: object, close: Function, closePromise?: Promise<unknown>}} authority - Authority close target.
 * @returns {Promise<boolean>} - Whether any close failed.
 */
async function closeOwnedCapabilities(children, authority) {
  const childResults = await Promise.allSettled(
    [...children].reverse().map(invokeClose),
  );
  const authorityResult = await Promise.allSettled([invokeClose(authority)]);
  return [...childResults, ...authorityResult].some(
    (result) => result.status === 'rejected',
  );
}

/**
 * Transfer one already-resolved AWS deployment authority into a complete,
 * invocation-owned client family.
 * @param {unknown} authorityValue - Exact real authority surface.
 * @returns {Promise<Readonly<{
 *   providerScope: Readonly<import('./deployment-provider-scope.js').AwsProviderScope>,
 *   scopeResolver: Readonly<{resolveScope: (...args: any[]) => any}>,
 *   clients: Readonly<{
 *     deploymentStore: object,
 *     dynamoControl: object,
 *     s3Control: object,
 *     providerSpecRead: object,
 *     managedArtifact: object,
 *     volume: object,
 *     network: object,
 *     runtimeIdentity: object,
 *     node: object,
 *     volumeAttachment: object,
 *   }>,
 *   close: () => Promise<void>,
 * }>>} - Complete client family.
 */
export async function createAwsDeploymentClientFamilyFromAuthority(
  authorityValue,
) {
  const { authority, providerScope } = validateAuthority(authorityValue);
  if (CLAIMED_AUTHORITIES.has(authority)) {
    throw new TypeError(INVALID_AUTHORITY_ERROR);
  }

  const authorityMethods = /** @type {Record<string, Function>} */ ({});
  for (const method of AUTHORITY_METHOD_KEYS) {
    authorityMethods[method] = captureMethod(authority, method);
  }
  const authorityClose = {
    owner: authority,
    close: authorityMethods.close,
  };
  CLAIMED_AUTHORITIES.add(authority);

  let closing = false;
  /** @returns {void} */
  function assertFamilyOpen() {
    if (closing) throw new Error(CLOSED_ERROR);
  }

  /** @type {Array<{owner: object, close: Function, closePromise?: Promise<unknown>}>} */
  const issuedChildren = [];
  /** @type {Set<object>} */
  const issuedOwners = new Set();
  /** @type {Record<string, Readonly<Record<string, Function>>>} */
  const clients = {};
  try {
    for (const definition of CLIENT_DEFINITIONS) {
      const client = Reflect.apply(
        authorityMethods[definition.factory],
        authority,
        [],
      );
      const target = captureCloseTarget(client);
      if (issuedOwners.has(target.owner)) {
        throw new Error(INITIALIZATION_ERROR);
      }
      issuedOwners.add(target.owner);
      issuedChildren.push(target);
      clients[definition.key] = projectClient(
        definition.key,
        target.owner,
        target,
        assertFamilyOpen,
      );
    }
  } catch {
    await closeOwnedCapabilities(issuedChildren, authorityClose);
    throw new AwsDeploymentClientFamilyInitializationError();
  }

  /** @type {Promise<void> | undefined} */
  let closePromise;
  /** @type {(...args: any[]) => any} */
  const resolveScope = (...args) => {
    assertFamilyOpen();
    return Reflect.apply(authorityMethods.resolveScope, authority, args);
  };
  const scopeResolver = Object.freeze({
    resolveScope,
  });
  /** @type {Readonly<AwsDeploymentClientMap>} */
  const frozenClients = /** @type {AwsDeploymentClientMap} */ (
    /** @type {unknown} */ (Object.freeze(clients))
  );

  /** @returns {Promise<void>} - Memoized complete close. */
  function close() {
    if (!closePromise) {
      closing = true;
      closePromise = (async () => {
        const failed = await closeOwnedCapabilities(
          issuedChildren,
          authorityClose,
        );
        if (failed) throw new AwsDeploymentClientFamilyCloseError();
      })();
    }
    return closePromise;
  }

  return Object.freeze({
    providerScope,
    scopeResolver,
    clients: frozenClients,
    close,
  });
}

/**
 * Resolve ordinary AWS credentials for one explicit region and immediately
 * transfer the resulting authority into one invocation-owned client family.
 * @param {unknown} options - Exact `{region}` options.
 * @returns {ReturnType<typeof createAwsDeploymentClientFamilyFromAuthority>} - Complete client family.
 */
export async function openAwsDeploymentClientFamily(options) {
  const regionDescriptor =
    isPlainObject(options) &&
    Object.getOwnPropertyDescriptor(options, 'region');
  if (
    !isPlainObject(options) ||
    Reflect.ownKeys(options).length !== OPEN_OPTIONS_KEYS.size ||
    !regionDescriptor ||
    !regionDescriptor.enumerable ||
    !Object.hasOwn(regionDescriptor, 'value') ||
    typeof regionDescriptor.value !== 'string'
  ) {
    throw new TypeError(INVALID_OPTIONS_ERROR);
  }
  const authority = await createAwsDeploymentAuthority(
    /** @type {{region: string}} */ (options),
  );
  try {
    return await createAwsDeploymentClientFamilyFromAuthority(authority);
  } catch (error) {
    try {
      await authority.close();
    } catch {
      // Preserve the fixed transfer failure; the authority close is best-effort.
    }
    throw error;
  }
}

export default {
  AwsDeploymentClientFamilyCloseError,
  AwsDeploymentClientFamilyInitializationError,
  createAwsDeploymentClientFamilyFromAuthority,
  openAwsDeploymentClientFamily,
};
