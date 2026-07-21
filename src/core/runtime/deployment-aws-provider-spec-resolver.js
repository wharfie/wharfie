/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact provider-boundary contracts are clearer than parser-specific expansions. */

import { validateSha256Digest } from './application-revision.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import {
  assertDeploymentInstanceId,
  getDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';
import { validateDeploymentRevision } from './deployment-revision.js';
import { assertDeploymentIncarnationId } from './deployment-resource-binding.js';
import { cloneJsonObject } from './json-value.js';

export const AWS_SINGLE_NODE_PROVIDER_SPEC_RESOLVER_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_PROVIDER_SPEC_RESOLVER_MAX_ATTEMPTS = 10;

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'bootstrapDigest',
  'runtimeIdentityPolicyDigest',
  'now',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set([
  'client',
  'providerScope',
  'bootstrapDigest',
  'runtimeIdentityPolicyDigest',
  'now',
]);
const RESOLVE_CONTEXT_KEYS = new Set([
  'operation',
  'deploymentRevision',
  'providerScope',
  'deploymentInstanceId',
  'incarnationId',
  'profile',
  'head',
]);
const VALIDATE_CONTEXT_KEYS = new Set([
  ...RESOLVE_CONTEXT_KEYS,
  'providerSpec',
]);
const REQUIRED_CLIENT_METHODS = Object.freeze([
  'getParameter',
  'describeImages',
  'describeAvailabilityZones',
  'describeInstanceTypeOfferings',
  'getEbsDefaultKmsKeyId',
]);
const AMI_ID_PATTERN = /^ami-[0-9a-f]{8,32}$/;
const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const AVAILABILITY_ZONE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-az[1-9][0-9]*$/;
const KMS_KEY_ARN_PATTERN =
  /^arn:([a-z0-9-]+):kms:([a-z0-9-]+):([0-9]{12}):key\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|mrk-[0-9a-f]{32})$/;
const TRANSITIONAL_IMAGE_STATES = new Set(['pending', 'transient']);
const INSTANCE_TYPE_OFFERING_MAX_RESULTS = 1000;
const INSTANCE_TYPE_OFFERING_MAX_PAGES = 10;

/** The exact public SSM parameter or selected AMI is absent. */
export class AwsSingleNodeProviderSpecMissingError extends Error {
  constructor() {
    super('Required AWS provider-spec discovery evidence is absent.');
    this.name = 'AwsSingleNodeProviderSpecMissingError';
    this.code = 'AWS_SINGLE_NODE_PROVIDER_SPEC_MISSING';
  }
}

/** Provider discovery evidence contradicts the fixed provider contract. */
export class AwsSingleNodeProviderSpecConflictError extends Error {
  constructor() {
    super('AWS provider-spec discovery evidence conflicts with its contract.');
    this.name = 'AwsSingleNodeProviderSpecConflictError';
    this.code = 'AWS_SINGLE_NODE_PROVIDER_SPEC_CONFLICT';
  }
}

/** A bounded provider read could not establish authoritative state. */
export class AwsSingleNodeProviderSpecUnknownError extends Error {
  constructor() {
    super('AWS provider-spec discovery state is unknown.');
    this.name = 'AwsSingleNodeProviderSpecUnknownError';
    this.code = 'AWS_SINGLE_NODE_PROVIDER_SPEC_UNKNOWN';
  }
}

class ImageTransitionError extends Error {}
class ProviderResponseUnknownError extends Error {}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertSupportedKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertRequiredKeys(value, keys, path) {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** @param {unknown} error @param {string} name @returns {boolean} */
function errorNamed(error, name) {
  return (
    error !== null &&
    typeof error === 'object' &&
    /** @type {Record<string, any>} */ (error).name === name
  );
}

/** @param {unknown} error @returns {boolean} */
function isMissingParameterError(error) {
  return (
    errorNamed(error, 'ParameterNotFound') ||
    errorNamed(error, 'ParameterVersionNotFound')
  );
}

/** @returns {Promise<void>} */
async function defaultWaitForRetry() {
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

/** @param {unknown} value @returns {number} */
function validateNow(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AwsSingleNodeProviderSpecUnknownError();
  }
  return value;
}

/**
 * Validate a controller context before any provider read. This resolver owns
 * only unaccepted fresh-incarnation discovery: an absent deployment or a
 * fully destroyed tombstone. Retained bindings may remain tied to the old
 * incarnation and do not authorize discovery for the fresh one.
 * @param {unknown} value - Candidate controller context.
 * @param {Set<string>} keys - Resolve or validation keys.
 * @param {Readonly<Record<string, any>>} configuredScope - Credential-bound scope.
 * @returns {Record<string, any>} - Canonical exact context.
 */
function validateContext(value, keys, configuredScope) {
  const input = cloneJsonObject(value, 'awsProviderSpecResolver context');
  assertSupportedKeys(input, keys, 'awsProviderSpecResolver context');
  assertRequiredKeys(input, keys, 'awsProviderSpecResolver context');
  if (input.operation !== 'apply') {
    throw new AwsSingleNodeProviderSpecConflictError();
  }
  const deploymentRevision = validateDeploymentRevision(
    input.deploymentRevision,
    'awsProviderSpecResolver context.deploymentRevision',
  );
  const profile = validateDeploymentProfile(
    input.profile,
    'awsProviderSpecResolver context.profile',
  );
  const providerScope = validateProviderScope(
    input.providerScope,
    'awsProviderSpecResolver context.providerScope',
  );
  assertDeploymentInstanceId(
    input.deploymentInstanceId,
    'awsProviderSpecResolver context.deploymentInstanceId',
  );
  assertDeploymentIncarnationId(
    input.incarnationId,
    'awsProviderSpecResolver context.incarnationId',
  );

  const expectedInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  if (
    providerScope.providerScopeId !== configuredScope.providerScopeId ||
    profile.provider.kind !== 'aws' ||
    profile.provider.scope.region !== providerScope.region ||
    profile.profileRevisionId !== deploymentRevision.profileRevisionId ||
    profile.appId !== deploymentRevision.appId ||
    input.deploymentInstanceId !== expectedInstanceId
  ) {
    throw new AwsSingleNodeProviderSpecConflictError();
  }

  const head =
    input.head === null
      ? null
      : validateDeploymentHead(
          input.head,
          'awsProviderSpecResolver context.head',
        );
  if (
    head !== null &&
    (head.phase !== 'DESTROYED' ||
      head.activeOperation !== null ||
      head.deploymentInstanceId !== input.deploymentInstanceId ||
      head.providerScope.providerScopeId !== providerScope.providerScopeId ||
      head.incarnationId === input.incarnationId)
  ) {
    throw new AwsSingleNodeProviderSpecConflictError();
  }

  /** @type {Record<string, any>} */
  const context = {
    operation: 'apply',
    deploymentRevision,
    providerScope,
    deploymentInstanceId: input.deploymentInstanceId,
    incarnationId: input.incarnationId,
    profile,
    head,
  };
  if (keys === VALIDATE_CONTEXT_KEYS) {
    context.providerSpec = validateAwsSingleNodeProviderSpecContext(
      input.providerSpec,
      { profile, providerScope },
    );
  }
  return context;
}

/** @param {Readonly<Record<string, any>>} providerScope @param {string} parameterName @returns {string} */
function parameterArn(providerScope, parameterName) {
  return `arn:${providerScope.partition}:ssm:${providerScope.region}::parameter${parameterName}`;
}

/**
 * Turn one strict SSM response into a frozen selection. Its timestamp is
 * validated but deliberately excluded from the content-addressed provider
 * specification because it is provider observation metadata, not behavior.
 * @param {unknown} value - GetParameter response.
 * @param {Readonly<Record<string, any>>} providerScope - Exact AWS scope.
 * @param {string} parameterName - Fixed AL2023 public parameter.
 * @param {number|null} expectedVersion - Exact version during validation.
 * @returns {Readonly<{name: string, version: number, imageId: string}>} - Frozen SSM selection.
 */
function validateParameterResponse(
  value,
  providerScope,
  parameterName,
  expectedVersion,
) {
  if (
    !isPlainObject(value) ||
    value.Parameter === undefined ||
    !isPlainObject(value.Parameter)
  ) {
    throw new ProviderResponseUnknownError();
  }
  const parameter = value.Parameter;
  const modifiedAt =
    parameter.LastModifiedDate instanceof Date
      ? parameter.LastModifiedDate.getTime()
      : Number.NaN;
  const selector = parameter.Selector;
  const selectorMatches =
    selector === undefined ||
    (expectedVersion !== null && selector === `:${expectedVersion}`);
  if (
    parameter.Name !== parameterName ||
    parameter.Type !== 'String' ||
    parameter.DataType !== 'text' ||
    parameter.ARN !== parameterArn(providerScope, parameterName) ||
    typeof parameter.Value !== 'string' ||
    !AMI_ID_PATTERN.test(parameter.Value) ||
    !Number.isSafeInteger(parameter.Version) ||
    parameter.Version < 1 ||
    (expectedVersion !== null && parameter.Version !== expectedVersion) ||
    !Number.isFinite(modifiedAt) ||
    modifiedAt < 0 ||
    !selectorMatches ||
    parameter.SourceResult !== undefined
  ) {
    throw new AwsSingleNodeProviderSpecConflictError();
  }
  return deepFreeze({
    name: parameterName,
    version: parameter.Version,
    imageId: parameter.Value,
  });
}

/** @param {unknown} value @param {number} now @returns {boolean} */
function isNonexpiredDeprecation(value, now) {
  if (value === undefined) return true;
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/u.exec(value);
  if (!match) return false;
  const milliseconds = Date.parse(value);
  const normalized = `${match[1]}.${(match[2] || '').padEnd(3, '0')}Z`;
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === normalized &&
    milliseconds > now
  );
}

/**
 * Validate the one exact EC2 image returned for a frozen SSM selection.
 * Pending/transient states are distinguished so the caller may re-read this
 * exact AMI without ever returning to the moving SSM alias.
 * @param {unknown} value - DescribeImages response.
 * @param {Readonly<{name: string, version: number, imageId: string}>} selection - Frozen SSM selection.
 * @param {'x86_64'|'arm64'} architecture - Exact target architecture.
 * @param {number} now - Post-response time for deprecation validation.
 * @returns {Readonly<Record<string, any>>} - Provider-spec machine-image receipt.
 */
function validateImageResponse(value, selection, architecture, now) {
  if (!isPlainObject(value) || !Array.isArray(value.Images)) {
    throw new ProviderResponseUnknownError();
  }
  if (value.NextToken !== undefined && value.NextToken !== null) {
    throw new AwsSingleNodeProviderSpecConflictError();
  }
  if (value.Images.length === 0) {
    throw new ImageTransitionError();
  }
  if (value.Images.length !== 1) {
    throw new AwsSingleNodeProviderSpecConflictError();
  }
  if (!isPlainObject(value.Images[0])) {
    throw new ProviderResponseUnknownError();
  }
  const image = value.Images[0];
  if (image.ImageId !== selection.imageId) {
    throw new AwsSingleNodeProviderSpecConflictError();
  }
  if (TRANSITIONAL_IMAGE_STATES.has(image.State)) {
    throw new ImageTransitionError();
  }
  if (
    typeof image.OwnerId !== 'string' ||
    !AWS_ACCOUNT_ID_PATTERN.test(image.OwnerId) ||
    image.ImageOwnerAlias !== 'amazon' ||
    image.Public !== true ||
    image.Architecture !== architecture ||
    image.ImageType !== 'machine' ||
    image.RootDeviceType !== 'ebs' ||
    image.VirtualizationType !== 'hvm' ||
    image.EnaSupport !== true ||
    image.Platform !== undefined ||
    image.PlatformDetails !== 'Linux/UNIX' ||
    image.PublicSsmParameterName !== selection.name.slice(1) ||
    image.ImageAllowed === false ||
    !isNonexpiredDeprecation(image.DeprecationTime, now)
  ) {
    throw new AwsSingleNodeProviderSpecConflictError();
  }
  if (image.State !== 'available') {
    throw new AwsSingleNodeProviderSpecConflictError();
  }
  return deepFreeze({
    sourceParameter: {
      name: selection.name,
      version: selection.version,
    },
    imageId: selection.imageId,
    ownerAccountId: image.OwnerId,
    architecture,
    imageType: 'machine',
    rootDeviceType: 'ebs',
    virtualizationType: 'hvm',
    enaSupport: true,
  });
}

/** @param {Record<string, any>} value @param {string} key @param {unknown} expected @returns {void} */
function assertExactProviderField(value, key, expected) {
  if (!Object.hasOwn(value, key)) throw new ProviderResponseUnknownError();
  if (value[key] !== expected) {
    throw new AwsSingleNodeProviderSpecConflictError();
  }
}

/** @param {string} value @returns {string} */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Validate the complete, non-paginated standard-AZ response. Missing fields
 * cannot establish state, while present fields that contradict the exact
 * request are authoritative conflicts.
 * @param {unknown} value - DescribeAvailabilityZones response.
 * @param {Readonly<Record<string, any>>} providerScope - Exact AWS scope.
 * @param {string|null} exactAvailabilityZoneId - Pinned ID during validation.
 * @returns {Readonly<string[]>} - Sorted available standard AZ IDs.
 */
function validateAvailabilityZonesResponse(
  value,
  providerScope,
  exactAvailabilityZoneId,
) {
  if (!isPlainObject(value) || !Array.isArray(value.AvailabilityZones)) {
    throw new ProviderResponseUnknownError();
  }
  if (value.NextToken !== undefined && value.NextToken !== null) {
    throw new AwsSingleNodeProviderSpecConflictError();
  }
  if (value.AvailabilityZones.length === 0) {
    throw new AwsSingleNodeProviderSpecMissingError();
  }
  const zoneNamePattern = new RegExp(
    `^${escapeRegExp(providerScope.region)}[a-z]$`,
    'u',
  );
  const ids = new Set();
  for (const candidate of value.AvailabilityZones) {
    if (!isPlainObject(candidate)) {
      throw new ProviderResponseUnknownError();
    }
    if (!Object.hasOwn(candidate, 'ZoneId')) {
      throw new ProviderResponseUnknownError();
    }
    if (
      typeof candidate.ZoneId !== 'string' ||
      !AVAILABILITY_ZONE_ID_PATTERN.test(candidate.ZoneId)
    ) {
      throw new AwsSingleNodeProviderSpecConflictError();
    }
    if (!Object.hasOwn(candidate, 'ZoneName')) {
      throw new ProviderResponseUnknownError();
    }
    if (
      typeof candidate.ZoneName !== 'string' ||
      !zoneNamePattern.test(candidate.ZoneName)
    ) {
      throw new AwsSingleNodeProviderSpecConflictError();
    }
    assertExactProviderField(candidate, 'RegionName', providerScope.region);
    assertExactProviderField(candidate, 'ZoneType', 'availability-zone');
    assertExactProviderField(candidate, 'State', 'available');
    assertExactProviderField(candidate, 'OptInStatus', 'opt-in-not-required');
    if (
      candidate.ParentZoneId !== undefined ||
      candidate.ParentZoneName !== undefined ||
      ids.has(candidate.ZoneId)
    ) {
      throw new AwsSingleNodeProviderSpecConflictError();
    }
    if (
      exactAvailabilityZoneId !== null &&
      candidate.ZoneId !== exactAvailabilityZoneId
    ) {
      throw new AwsSingleNodeProviderSpecConflictError();
    }
    ids.add(candidate.ZoneId);
  }
  if (exactAvailabilityZoneId !== null && ids.size !== 1) {
    throw new AwsSingleNodeProviderSpecConflictError();
  }
  return deepFreeze([...ids].sort());
}

/**
 * Validate one offerings page against its immutable filter.
 * @param {unknown} value - DescribeInstanceTypeOfferings response.
 * @param {string} instanceType - Fixed architecture-derived instance type.
 * @param {string|null} exactAvailabilityZoneId - Pinned ID during validation.
 * @returns {Readonly<{availabilityZoneIds: string[], nextToken: string|null}>} - Strict page.
 */
function validateInstanceTypeOfferingsResponse(
  value,
  instanceType,
  exactAvailabilityZoneId,
) {
  if (!isPlainObject(value) || !Array.isArray(value.InstanceTypeOfferings)) {
    throw new ProviderResponseUnknownError();
  }
  let nextToken = null;
  if (value.NextToken !== undefined && value.NextToken !== null) {
    if (typeof value.NextToken !== 'string' || value.NextToken.length === 0) {
      throw new ProviderResponseUnknownError();
    }
    nextToken = value.NextToken;
  }
  const ids = [];
  for (const offering of value.InstanceTypeOfferings) {
    if (!isPlainObject(offering)) {
      throw new ProviderResponseUnknownError();
    }
    assertExactProviderField(offering, 'InstanceType', instanceType);
    assertExactProviderField(offering, 'LocationType', 'availability-zone-id');
    if (!Object.hasOwn(offering, 'Location')) {
      throw new ProviderResponseUnknownError();
    }
    if (
      typeof offering.Location !== 'string' ||
      !AVAILABILITY_ZONE_ID_PATTERN.test(offering.Location) ||
      (exactAvailabilityZoneId !== null &&
        offering.Location !== exactAvailabilityZoneId)
    ) {
      throw new AwsSingleNodeProviderSpecConflictError();
    }
    ids.push(offering.Location);
  }
  return deepFreeze({ availabilityZoneIds: ids, nextToken });
}

/**
 * Validate the exact regional default EBS KMS key receipt. EC2 documents this
 * field as a key ARN, so aliases and bare key IDs are contract conflicts.
 * @param {unknown} value - GetEbsDefaultKmsKeyId response.
 * @param {Readonly<Record<string, any>>} providerScope - Exact AWS scope.
 * @returns {Readonly<{ebsKmsKeyArn: string}>} - Frozen encryption selection.
 */
function validateEbsDefaultKmsKeyResponse(value, providerScope) {
  if (!isPlainObject(value) || !Object.hasOwn(value, 'KmsKeyId')) {
    throw new ProviderResponseUnknownError();
  }
  if (typeof value.KmsKeyId !== 'string') {
    throw new ProviderResponseUnknownError();
  }
  const match = KMS_KEY_ARN_PATTERN.exec(value.KmsKeyId);
  if (
    match === null ||
    match[1] !== providerScope.partition ||
    match[2] !== providerScope.region ||
    match[3] !== providerScope.accountId
  ) {
    throw new AwsSingleNodeProviderSpecConflictError();
  }
  return deepFreeze({ ebsKmsKeyArn: value.KmsKeyId });
}

/**
 * Build the strict AWS single-node SSM/EC2 resolver around one caller-owned,
 * credential-bound read client. This boundary never closes or replaces the
 * client and never exposes raw provider errors.
 * @param {unknown} options - Exact client, scope, behavior digests, clock, and retry policy.
 * @returns {Readonly<{resolveProviderSpec: (context: unknown) => Promise<Readonly<Record<string, any>>>, validateProviderSpec: (context: unknown) => Promise<Readonly<Record<string, any>>>}>} - Provider controller ports.
 */
export function createAwsSingleNodeProviderSpecResolver(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('awsProviderSpecResolver options must be an object.');
  }
  assertSupportedKeys(options, FACTORY_KEYS, 'awsProviderSpecResolver options');
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsProviderSpecResolver options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError('awsProviderSpecResolver client must be an object.');
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `awsProviderSpecResolver client.${method} must be a function.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsProviderSpecResolver options.providerScope',
  );
  const bootstrapDigest = deepFreeze(
    validateSha256Digest(
      options.bootstrapDigest,
      'awsProviderSpecResolver options.bootstrapDigest',
    ),
  );
  const runtimeIdentityPolicyDigest = deepFreeze(
    validateSha256Digest(
      options.runtimeIdentityPolicyDigest,
      'awsProviderSpecResolver options.runtimeIdentityPolicyDigest',
    ),
  );
  if (typeof options.now !== 'function') {
    throw new TypeError('awsProviderSpecResolver now must be a function.');
  }
  const now = options.now;
  const maxAttempts =
    options.maxAttempts ??
    AWS_SINGLE_NODE_PROVIDER_SPEC_RESOLVER_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_PROVIDER_SPEC_RESOLVER_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsProviderSpecResolver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_PROVIDER_SPEC_RESOLVER_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsProviderSpecResolver waitForRetry must be a function.',
    );
  }

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeProviderSpecUnknownError();
    }
  }

  /** @param {string} name @param {number|null} version @returns {Promise<Readonly<{name: string, version: number, imageId: string}>>} */
  async function readParameter(name, version) {
    const request = Object.freeze({
      Name: version === null ? name : `${name}:${version}`,
      WithDecryption: false,
    });
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        response = await client.getParameter(request);
      } catch (error) {
        if (isMissingParameterError(error)) {
          throw new AwsSingleNodeProviderSpecMissingError();
        }
        if (attempt === maxAttempts) {
          throw new AwsSingleNodeProviderSpecUnknownError();
        }
        await wait(attempt);
        continue;
      }
      try {
        return validateParameterResponse(
          response,
          providerScope,
          name,
          version,
        );
      } catch (error) {
        if (!(error instanceof ProviderResponseUnknownError)) throw error;
        if (attempt === maxAttempts) {
          throw new AwsSingleNodeProviderSpecUnknownError();
        }
        await wait(attempt);
      }
    }
    throw new AwsSingleNodeProviderSpecUnknownError();
  }

  /** @param {Readonly<{name: string, version: number, imageId: string}>} selection @param {'x86_64'|'arm64'} architecture @returns {Promise<Readonly<Record<string, any>>>} */
  async function readImage(selection, architecture) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await client.describeImages(
          Object.freeze({
            ImageIds: Object.freeze([selection.imageId]),
            Owners: Object.freeze(['amazon']),
            IncludeDeprecated: true,
            IncludeDisabled: true,
          }),
        );
        return validateImageResponse(
          response,
          selection,
          architecture,
          validateNow(now()),
        );
      } catch (error) {
        if (
          error instanceof AwsSingleNodeProviderSpecConflictError ||
          error instanceof AwsSingleNodeProviderSpecUnknownError
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          throw new AwsSingleNodeProviderSpecUnknownError();
        }
        await wait(attempt);
      }
    }
    throw new AwsSingleNodeProviderSpecUnknownError();
  }

  /** @param {string|null} exactAvailabilityZoneId @returns {Promise<Readonly<string[]>>} */
  async function readAvailabilityZones(exactAvailabilityZoneId) {
    const request = deepFreeze({
      AllAvailabilityZones: false,
      Filters: [
        { Name: 'region-name', Values: [providerScope.region] },
        { Name: 'state', Values: ['available'] },
        { Name: 'zone-type', Values: ['availability-zone'] },
      ],
      ...(exactAvailabilityZoneId === null
        ? {}
        : { ZoneIds: [exactAvailabilityZoneId] }),
    });
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        response = await client.describeAvailabilityZones(request);
      } catch {
        if (attempt === maxAttempts) {
          throw new AwsSingleNodeProviderSpecUnknownError();
        }
        await wait(attempt);
        continue;
      }
      try {
        return validateAvailabilityZonesResponse(
          response,
          providerScope,
          exactAvailabilityZoneId,
        );
      } catch (error) {
        if (!(error instanceof ProviderResponseUnknownError)) throw error;
        if (attempt === maxAttempts) {
          throw new AwsSingleNodeProviderSpecUnknownError();
        }
        await wait(attempt);
      }
    }
    throw new AwsSingleNodeProviderSpecUnknownError();
  }

  /** @param {Readonly<Record<string, any>>} request @param {string} instanceType @param {string|null} exactAvailabilityZoneId @returns {Promise<Readonly<{availabilityZoneIds: string[], nextToken: string|null}>>} */
  async function readInstanceTypeOfferingsPage(
    request,
    instanceType,
    exactAvailabilityZoneId,
  ) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        response = await client.describeInstanceTypeOfferings(request);
      } catch {
        if (attempt === maxAttempts) {
          throw new AwsSingleNodeProviderSpecUnknownError();
        }
        await wait(attempt);
        continue;
      }
      try {
        return validateInstanceTypeOfferingsResponse(
          response,
          instanceType,
          exactAvailabilityZoneId,
        );
      } catch (error) {
        if (!(error instanceof ProviderResponseUnknownError)) throw error;
        if (attempt === maxAttempts) {
          throw new AwsSingleNodeProviderSpecUnknownError();
        }
        await wait(attempt);
      }
    }
    throw new AwsSingleNodeProviderSpecUnknownError();
  }

  /** @param {string} instanceType @param {string|null} exactAvailabilityZoneId @returns {Promise<Readonly<string[]>>} */
  async function readInstanceTypeOfferings(
    instanceType,
    exactAvailabilityZoneId,
  ) {
    const filters = [
      { Name: 'instance-type', Values: [instanceType] },
      ...(exactAvailabilityZoneId === null
        ? []
        : [{ Name: 'location', Values: [exactAvailabilityZoneId] }]),
    ];
    const ids = new Set();
    const seenTokens = new Set();
    let nextToken = null;
    for (let page = 1; page <= INSTANCE_TYPE_OFFERING_MAX_PAGES; page += 1) {
      const request = deepFreeze({
        LocationType: 'availability-zone-id',
        Filters: filters,
        MaxResults: INSTANCE_TYPE_OFFERING_MAX_RESULTS,
        ...(nextToken === null ? {} : { NextToken: nextToken }),
      });
      const response = await readInstanceTypeOfferingsPage(
        request,
        instanceType,
        exactAvailabilityZoneId,
      );
      for (const availabilityZoneId of response.availabilityZoneIds) {
        if (ids.has(availabilityZoneId)) {
          throw new AwsSingleNodeProviderSpecConflictError();
        }
        ids.add(availabilityZoneId);
      }
      if (response.nextToken === null) {
        if (ids.size === 0) {
          throw new AwsSingleNodeProviderSpecMissingError();
        }
        return deepFreeze([...ids].sort());
      }
      if (
        page === INSTANCE_TYPE_OFFERING_MAX_PAGES ||
        seenTokens.has(response.nextToken)
      ) {
        throw new AwsSingleNodeProviderSpecUnknownError();
      }
      seenTokens.add(response.nextToken);
      nextToken = response.nextToken;
    }
    throw new AwsSingleNodeProviderSpecUnknownError();
  }

  /** @param {string} instanceType @param {string|null} exactAvailabilityZoneId @returns {Promise<Readonly<{availabilityZoneId: string}>>} */
  async function readPlacement(instanceType, exactAvailabilityZoneId) {
    const availableZoneIds = await readAvailabilityZones(
      exactAvailabilityZoneId,
    );
    const offeringZoneIds = await readInstanceTypeOfferings(
      instanceType,
      exactAvailabilityZoneId,
    );
    const available = new Set(availableZoneIds);
    const candidates = offeringZoneIds.filter((id) => available.has(id));
    if (candidates.length === 0) {
      throw new AwsSingleNodeProviderSpecMissingError();
    }
    if (
      exactAvailabilityZoneId !== null &&
      (candidates.length !== 1 || candidates[0] !== exactAvailabilityZoneId)
    ) {
      throw new AwsSingleNodeProviderSpecConflictError();
    }
    return deepFreeze({ availabilityZoneId: candidates.sort()[0] });
  }

  /** @param {string|null} exactKmsKeyArn @returns {Promise<Readonly<{ebsKmsKeyArn: string}>>} */
  async function readStorage(exactKmsKeyArn) {
    const request = Object.freeze({});
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        response = await client.getEbsDefaultKmsKeyId(request);
      } catch {
        if (attempt === maxAttempts) {
          throw new AwsSingleNodeProviderSpecUnknownError();
        }
        await wait(attempt);
        continue;
      }
      try {
        const storage = validateEbsDefaultKmsKeyResponse(
          response,
          providerScope,
        );
        if (
          exactKmsKeyArn !== null &&
          storage.ebsKmsKeyArn !== exactKmsKeyArn
        ) {
          throw new AwsSingleNodeProviderSpecConflictError();
        }
        return storage;
      } catch (error) {
        if (!(error instanceof ProviderResponseUnknownError)) throw error;
        if (attempt === maxAttempts) {
          throw new AwsSingleNodeProviderSpecUnknownError();
        }
        await wait(attempt);
      }
    }
    throw new AwsSingleNodeProviderSpecUnknownError();
  }

  /** @param {Record<string, any>} context @param {number|null} exactVersion @param {string|null} exactImageId @param {string|null} exactAvailabilityZoneId @param {string|null} exactKmsKeyArn @returns {Promise<Readonly<Record<string, any>>>} */
  async function discover(
    context,
    exactVersion,
    exactImageId,
    exactAvailabilityZoneId,
    exactKmsKeyArn,
  ) {
    const architecture =
      context.profile.target.architecture === 'x64' ? 'x86_64' : 'arm64';
    const instanceType = architecture === 'x86_64' ? 't3.small' : 't4g.small';
    const parameterName =
      AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS[architecture];
    const selection = await readParameter(parameterName, exactVersion);
    if (exactImageId !== null && selection.imageId !== exactImageId) {
      throw new AwsSingleNodeProviderSpecConflictError();
    }
    // Placement can paginate or retry. Resolve it before the AMI observation
    // so the deprecation clock is sampled only after the final provider read.
    const placement = await readPlacement(
      instanceType,
      exactAvailabilityZoneId,
    );
    const storage = await readStorage(exactKmsKeyArn);
    const machineImage = await readImage(selection, architecture);
    try {
      return createAwsSingleNodeProviderSpec({
        profile: context.profile,
        providerScope: context.providerScope,
        machineImage,
        placement,
        storage,
        bootstrapDigest,
        runtimeIdentityPolicyDigest,
      });
    } catch {
      throw new AwsSingleNodeProviderSpecConflictError();
    }
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function resolveProviderSpec(value) {
    const context = validateContext(value, RESOLVE_CONTEXT_KEYS, providerScope);
    return await discover(context, null, null, null, null);
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function validateProviderSpec(value) {
    const context = validateContext(
      value,
      VALIDATE_CONTEXT_KEYS,
      providerScope,
    );
    const expected = context.providerSpec;
    const reproduced = await discover(
      context,
      expected.machineImage.sourceParameter.version,
      expected.machineImage.imageId,
      expected.placement.availabilityZoneId,
      expected.storage.ebsKmsKeyArn,
    );
    if (!sameJson(reproduced, expected)) {
      throw new AwsSingleNodeProviderSpecConflictError();
    }
    return expected;
  }

  return Object.freeze({ resolveProviderSpec, validateProviderSpec });
}

export default {
  AWS_SINGLE_NODE_PROVIDER_SPEC_RESOLVER_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_PROVIDER_SPEC_RESOLVER_MAX_ATTEMPTS,
  AwsSingleNodeProviderSpecConflictError,
  AwsSingleNodeProviderSpecMissingError,
  AwsSingleNodeProviderSpecUnknownError,
  createAwsSingleNodeProviderSpecResolver,
};
