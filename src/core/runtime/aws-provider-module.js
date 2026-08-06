/**
 * @typedef {Readonly<{
 *   clientDynamoDB: typeof import('@aws-sdk/client-dynamodb'),
 *   clientEC2: typeof import('@aws-sdk/client-ec2'),
 *   clientIAM: typeof import('@aws-sdk/client-iam'),
 *   clientS3: typeof import('@aws-sdk/client-s3'),
 *   clientSSM: typeof import('@aws-sdk/client-ssm'),
 *   clientSTS: typeof import('@aws-sdk/client-sts'),
 *   credentialProviders: typeof import('@aws-sdk/credential-providers'),
 *   libDynamoDB: typeof import('@aws-sdk/lib-dynamodb'),
 *   utilRetry: typeof import('@smithy/util-retry'),
 * }>} AwsSdkBindings
 */

import { WHARFIE_VERSION } from '../lib/version.js';

export const AWS_PROVIDER_PACKAGE_NAME = '@wharfie/aws';
export const AWS_PROVIDER_CONTRACT_VERSION = 1;
export const AWS_PROVIDER_PACKAGE_VERSION = WHARFIE_VERSION;

const CORE_PACKAGE_NAME = '@wharfie/wharfie';
const PACKAGE_VERSION_SEPARATOR = '@';

const INSTALL_MESSAGE = `AWS deployment support is not installed. Install '${AWS_PROVIDER_PACKAGE_NAME}@${AWS_PROVIDER_PACKAGE_VERSION}' next to '@wharfie/wharfie@${WHARFIE_VERSION}' and retry.`;
const INCOMPATIBLE_MESSAGE = `AWS deployment support is incompatible. Install matching '${AWS_PROVIDER_PACKAGE_NAME}@${AWS_PROVIDER_PACKAGE_VERSION}' and '@wharfie/wharfie@${WHARFIE_VERSION}' packages and retry.`;
const NOT_EMBEDDED_MESSAGE =
  "AWS deployment support was not embedded. Install matching '" +
  AWS_PROVIDER_PACKAGE_NAME +
  '@' +
  AWS_PROVIDER_PACKAGE_VERSION +
  "' beside '" +
  CORE_PACKAGE_NAME +
  PACKAGE_VERSION_SEPARATOR +
  WHARFIE_VERSION +
  "' in the builder, rebuild the application, and retry.";
const BINDING_KEYS = Object.freeze([
  'clientDynamoDB',
  'clientEC2',
  'clientIAM',
  'clientS3',
  'clientSSM',
  'clientSTS',
  'credentialProviders',
  'libDynamoDB',
  'utilRetry',
]);
const REQUIRED_CALLABLES = Object.freeze({
  clientDynamoDB: Object.freeze([
    'DynamoDB',
    'DynamoDBClient',
    'ProvisionedThroughputExceededException',
    'ResourceNotFoundException',
  ]),
  clientEC2: Object.freeze([
    'AssociateRouteTableCommand',
    'AttachInternetGatewayCommand',
    'AttachVolumeCommand',
    'AuthorizeSecurityGroupIngressCommand',
    'CreateInternetGatewayCommand',
    'CreateRouteCommand',
    'CreateRouteTableCommand',
    'CreateSecurityGroupCommand',
    'CreateSubnetCommand',
    'CreateVpcCommand',
    'CreateVolumeCommand',
    'DeleteInternetGatewayCommand',
    'DeleteRouteCommand',
    'DeleteRouteTableCommand',
    'DeleteSecurityGroupCommand',
    'DeleteSubnetCommand',
    'DeleteVolumeCommand',
    'DeleteVpcCommand',
    'DescribeAvailabilityZonesCommand',
    'DescribeImagesCommand',
    'DescribeInstanceAttributeCommand',
    'DescribeInstanceCreditSpecificationsCommand',
    'DescribeInstancesCommand',
    'DescribeInternetGatewaysCommand',
    'DescribeInstanceTypeOfferingsCommand',
    'DescribeNetworkAclsCommand',
    'DescribeRouteTablesCommand',
    'DescribeSecurityGroupsCommand',
    'DescribeSubnetsCommand',
    'DescribeVpcAttributeCommand',
    'DescribeVpcsCommand',
    'DescribeVolumesCommand',
    'DisassociateRouteTableCommand',
    'DetachInternetGatewayCommand',
    'DetachVolumeCommand',
    'EC2Client',
    'GetEbsDefaultKmsKeyIdCommand',
    'ModifyInstanceAttributeCommand',
    'RunInstancesCommand',
    'StartInstancesCommand',
    'TerminateInstancesCommand',
  ]),
  clientIAM: Object.freeze([
    'AddRoleToInstanceProfileCommand',
    'CreateInstanceProfileCommand',
    'CreateRoleCommand',
    'DeleteInstanceProfileCommand',
    'DeleteRoleCommand',
    'DeleteRolePolicyCommand',
    'GetInstanceProfileCommand',
    'GetRoleCommand',
    'GetRolePolicyCommand',
    'IAMClient',
    'ListAttachedRolePoliciesCommand',
    'ListInstanceProfilesForRoleCommand',
    'ListInstanceProfileTagsCommand',
    'ListRolePoliciesCommand',
    'ListRoleTagsCommand',
    'PutRolePolicyCommand',
    'RemoveRoleFromInstanceProfileCommand',
  ]),
  clientS3: Object.freeze(['GetObjectCommand', 'S3', 'S3Client']),
  clientSSM: Object.freeze(['GetParameterCommand', 'SSMClient']),
  clientSTS: Object.freeze(['GetCallerIdentityCommand', 'STSClient']),
  credentialProviders: Object.freeze(['fromNodeProviderChain']),
  libDynamoDB: Object.freeze([
    'DynamoDBDocument',
    'DynamoDBDocumentClient',
    'GetCommand',
  ]),
  utilRetry: Object.freeze(['ConfiguredRetryStrategy']),
});
const REQUIRED_STATIC_CALLABLES = Object.freeze([
  Object.freeze(['libDynamoDB', 'DynamoDBDocument', 'from']),
  Object.freeze(['libDynamoDB', 'DynamoDBDocumentClient', 'from']),
]);

/** AWS deployment was selected without its explicit provider package. */
export class AwsProviderUnavailableError extends Error {
  /** @param {{cause?: unknown, reason?: 'missing'|'incompatible'|'not-embedded'}} [options] - Stable public classification and optional private cause. */
  constructor(options = {}) {
    const reason = options.reason ?? 'missing';
    super(
      reason === 'incompatible'
        ? INCOMPATIBLE_MESSAGE
        : reason === 'not-embedded'
          ? NOT_EMBEDDED_MESSAGE
          : INSTALL_MESSAGE,
      {
        ...(options.cause === undefined ? {} : { cause: options.cause }),
      },
    );
    this.name = 'AwsProviderUnavailableError';
    this.code =
      reason === 'incompatible'
        ? 'WHARFIE_AWS_PROVIDER_INCOMPATIBLE'
        : reason === 'not-embedded'
          ? 'WHARFIE_AWS_PROVIDER_NOT_EMBEDDED'
          : 'WHARFIE_AWS_PROVIDER_UNAVAILABLE';
    this.reason = reason;
  }
}

/**
 * @param {unknown} value - Candidate provider namespace or SDK binding.
 * @returns {value is Record<string, any>} - True only for a non-array object.
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate the one versioned companion-package surface.
 * @param {unknown} namespace - Imported `@wharfie/aws` module.
 * @returns {AwsSdkBindings} - Exact SDK bindings.
 */
export function validateAwsProviderModule(namespace) {
  if (
    !isObject(namespace) ||
    namespace.WHARFIE_AWS_PROVIDER_PACKAGE_VERSION !==
      AWS_PROVIDER_PACKAGE_VERSION ||
    namespace.WHARFIE_AWS_PROVIDER_CONTRACT_VERSION !==
      AWS_PROVIDER_CONTRACT_VERSION ||
    typeof namespace.getAwsSdkBindings !== 'function'
  ) {
    throw new AwsProviderUnavailableError({ reason: 'incompatible' });
  }
  let bindings;
  try {
    bindings = namespace.getAwsSdkBindings();
  } catch (cause) {
    throw new AwsProviderUnavailableError({
      cause,
      reason: 'incompatible',
    });
  }
  if (
    !isObject(bindings) ||
    !Object.isFrozen(bindings) ||
    Reflect.ownKeys(bindings).length !== BINDING_KEYS.length ||
    BINDING_KEYS.some((key) => !isObject(bindings[key])) ||
    Object.entries(REQUIRED_CALLABLES).some(([bindingKey, exports]) =>
      exports.some(
        (exportName) =>
          typeof bindings[bindingKey]?.[exportName] !== 'function',
      ),
    ) ||
    REQUIRED_STATIC_CALLABLES.some(
      ([bindingKey, exportName, staticName]) =>
        typeof bindings[bindingKey]?.[exportName]?.[staticName] !== 'function',
    ) ||
    !isObject(bindings.clientDynamoDB.ReturnValue) ||
    bindings.clientDynamoDB.ReturnValue.NONE !== 'NONE'
  ) {
    throw new AwsProviderUnavailableError({ reason: 'incompatible' });
  }
  return /** @type {AwsSdkBindings} */ (bindings);
}

/** @type {Promise<AwsSdkBindings> | undefined} */
let defaultLoad;
/** @type {AwsSdkBindings | undefined} */
let registeredBindings;
let providerUnavailableSealed = false;

/**
 * Register the one fixed provider namespace already embedded by a generated
 * SEA entry. Registration is deliberately specific to AWS and may not replace
 * a previously validated binding surface.
 * @param {unknown} namespace - Statically embedded `@wharfie/aws` namespace.
 * @returns {AwsSdkBindings} - Registered validated SDK bindings.
 */
export function registerAwsProviderModule(namespace) {
  if (providerUnavailableSealed) {
    throw new AwsProviderUnavailableError({ reason: 'not-embedded' });
  }
  const bindings = validateAwsProviderModule(namespace);
  if (registeredBindings && registeredBindings !== bindings) {
    throw new AwsProviderUnavailableError({ reason: 'incompatible' });
  }
  registeredBindings = bindings;
  defaultLoad = Promise.resolve(bindings);
  return bindings;
}

/**
 * Permanently seal one generated provider-free application. Source CLI modules
 * never call this; a sealed SEA cannot discover a later external companion.
 * @returns {void}
 */
export function sealAwsProviderUnavailable() {
  if (registeredBindings || defaultLoad) {
    throw new AwsProviderUnavailableError({ reason: 'incompatible' });
  }
  providerUnavailableSealed = true;
}

/**
 * Read the already validated binding surface for synchronous host construction.
 * @returns {AwsSdkBindings} - Registered validated SDK bindings.
 */
export function getRegisteredAwsProviderBindings() {
  if (!registeredBindings) {
    throw new AwsProviderUnavailableError({
      reason: providerUnavailableSealed ? 'not-embedded' : 'missing',
    });
  }
  return registeredBindings;
}

/**
 * @param {unknown} cause - Dynamic-import failure.
 * @returns {boolean} - Whether the fixed provider package itself is absent.
 */
function isMissingProviderPackage(cause) {
  if (!isObject(cause) || cause.code !== 'ERR_MODULE_NOT_FOUND') return false;
  const message = typeof cause.message === 'string' ? cause.message : '';
  return /^Cannot find package ['"]@wharfie\/aws['"] imported from /u.test(
    message,
  );
}

/**
 * Convert dynamic-import failures into the stable fixed-provider boundary.
 * @param {unknown} cause - Provider import failure.
 * @returns {AwsProviderUnavailableError} - Stable missing or incompatible error.
 */
export function classifyAwsProviderImportFailure(cause) {
  if (cause instanceof AwsProviderUnavailableError) return cause;
  return new AwsProviderUnavailableError({
    cause,
    reason: isMissingProviderPackage(cause) ? 'missing' : 'incompatible',
  });
}

/**
 * Load only Wharfie's fixed AWS companion package. The non-literal import is
 * deliberate: provider-free SEA builds must not absorb the optional SDK graph.
 * @returns {Promise<AwsSdkBindings>} - Fixed SDK bindings.
 */
export function loadAwsProviderBindings() {
  if (providerUnavailableSealed) {
    return Promise.reject(
      new AwsProviderUnavailableError({ reason: 'not-embedded' }),
    );
  }
  if (registeredBindings) return Promise.resolve(registeredBindings);
  if (!defaultLoad) {
    const specifier = AWS_PROVIDER_PACKAGE_NAME;
    defaultLoad = import(specifier)
      .then(registerAwsProviderModule)
      .catch((cause) => {
        throw classifyAwsProviderImportFailure(cause);
      });
  }
  return /** @type {Promise<AwsSdkBindings>} */ (defaultLoad);
}

/**
 * Prove the explicit provider is available before starting an AWS operation.
 * @returns {Promise<void>} - Resolves only for the fixed compatible provider.
 */
export async function requireAwsProvider() {
  await loadAwsProviderBindings();
}
