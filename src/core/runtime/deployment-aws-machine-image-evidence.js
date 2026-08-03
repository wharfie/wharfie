/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider-evidence contracts are clearer than repeated parser-specific expansions. */

const AMI_ID_PATTERN = /^ami-[0-9a-f]{8,32}$/;
const SNAPSHOT_ID_PATTERN = /^snap-[0-9a-f]{8,32}$/;
const ROOT_DEVICE_NAME_PATTERN = /^\/dev\/(?:xvd|sd)[a-z](?:[1-9][0-9]*)?$/;
const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const TRANSITIONAL_IMAGE_STATES = new Set(['pending', 'transient']);

/** Present SSM or EC2 evidence contradicts the exact machine-image contract. */
export class AwsSingleNodeMachineImageEvidenceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node machine-image evidence conflicts with its exact contract.',
    );
    this.name = 'AwsSingleNodeMachineImageEvidenceConflictError';
    this.code = 'AWS_SINGLE_NODE_MACHINE_IMAGE_EVIDENCE_CONFLICT';
  }
}

/** Provider evidence is unavailable or structurally inconclusive. */
export class AwsSingleNodeMachineImageEvidenceUnknownError extends Error {
  constructor() {
    super('AWS single-node machine-image evidence is unknown.');
    this.name = 'AwsSingleNodeMachineImageEvidenceUnknownError';
    this.code = 'AWS_SINGLE_NODE_MACHINE_IMAGE_EVIDENCE_UNKNOWN';
  }
}

/** The exact selected image has not yet converged on an available state. */
export class AwsSingleNodeMachineImageEvidenceTransientError extends Error {
  constructor() {
    super('AWS single-node machine-image evidence is transient.');
    this.name = 'AwsSingleNodeMachineImageEvidenceTransientError';
    this.code = 'AWS_SINGLE_NODE_MACHINE_IMAGE_EVIDENCE_TRANSIENT';
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {Readonly<Record<string, any>>} providerScope @param {string} parameterName @returns {string} */
function parameterArn(providerScope, parameterName) {
  return `arn:${providerScope.partition}:ssm:${providerScope.region}::parameter${parameterName}`;
}

/**
 * Decode one strict public SSM parameter response into a frozen, version-pinned
 * machine-image selection. The observation timestamp is validated but omitted
 * from the selection because it does not affect provider behavior.
 * @param {unknown} value - GetParameter response.
 * @param {Readonly<Record<string, any>>} providerScope - Exact AWS scope.
 * @param {string} parameterName - Fixed AL2023 public parameter.
 * @param {number|null} expectedVersion - Exact version during validation.
 * @returns {Readonly<{name: string, version: number, imageId: string}>} - Frozen SSM selection.
 */
export function decodeAwsSingleNodeExactMachineImageParameterResponse(
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
    throw new AwsSingleNodeMachineImageEvidenceUnknownError();
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
    throw new AwsSingleNodeMachineImageEvidenceConflictError();
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
 * Decode the one exact EC2 image returned for a frozen SSM selection.
 * Pending/transient states remain distinct so a caller can retry this exact
 * AMI without returning to the moving public parameter alias.
 * @param {unknown} value - DescribeImages response.
 * @param {Readonly<{name: string, version: number, imageId: string}>} selection - Frozen SSM selection.
 * @param {'x86_64'|'arm64'} architecture - Exact target architecture.
 * @param {number} now - Post-response time for deprecation validation.
 * @returns {Readonly<Record<string, any>>} - Provider-spec machine-image receipt.
 */
export function decodeAwsSingleNodeExactMachineImageResponse(
  value,
  selection,
  architecture,
  now,
) {
  if (!isPlainObject(value) || !Array.isArray(value.Images)) {
    throw new AwsSingleNodeMachineImageEvidenceUnknownError();
  }
  if (value.NextToken !== undefined && value.NextToken !== null) {
    throw new AwsSingleNodeMachineImageEvidenceConflictError();
  }
  if (value.Images.length === 0) {
    throw new AwsSingleNodeMachineImageEvidenceTransientError();
  }
  if (value.Images.length !== 1) {
    throw new AwsSingleNodeMachineImageEvidenceConflictError();
  }
  if (!isPlainObject(value.Images[0])) {
    throw new AwsSingleNodeMachineImageEvidenceUnknownError();
  }
  const image = value.Images[0];
  if (image.ImageId !== selection.imageId) {
    throw new AwsSingleNodeMachineImageEvidenceConflictError();
  }
  if (TRANSITIONAL_IMAGE_STATES.has(image.State)) {
    throw new AwsSingleNodeMachineImageEvidenceTransientError();
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
    throw new AwsSingleNodeMachineImageEvidenceConflictError();
  }
  if (image.State !== 'available') {
    throw new AwsSingleNodeMachineImageEvidenceConflictError();
  }
  if (
    typeof image.RootDeviceName !== 'string' ||
    !ROOT_DEVICE_NAME_PATTERN.test(image.RootDeviceName) ||
    !Array.isArray(image.BlockDeviceMappings) ||
    image.BlockDeviceMappings.length !== 1 ||
    !isPlainObject(image.BlockDeviceMappings[0])
  ) {
    throw new AwsSingleNodeMachineImageEvidenceConflictError();
  }
  const rootMapping = image.BlockDeviceMappings[0];
  if (
    rootMapping.DeviceName !== image.RootDeviceName ||
    rootMapping.VirtualName !== undefined ||
    rootMapping.NoDevice !== undefined ||
    !isPlainObject(rootMapping.Ebs)
  ) {
    throw new AwsSingleNodeMachineImageEvidenceConflictError();
  }
  const rootEbs = rootMapping.Ebs;
  if (
    typeof rootEbs.SnapshotId !== 'string' ||
    !SNAPSHOT_ID_PATTERN.test(rootEbs.SnapshotId) ||
    rootEbs.VolumeType !== 'gp3' ||
    !Number.isSafeInteger(rootEbs.VolumeSize) ||
    rootEbs.VolumeSize < 8 ||
    rootEbs.VolumeSize > 64 ||
    rootEbs.Encrypted !== false ||
    rootEbs.DeleteOnTermination !== true
  ) {
    throw new AwsSingleNodeMachineImageEvidenceConflictError();
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
    rootDeviceName: image.RootDeviceName,
    rootBlockDevice: {
      snapshotId: rootEbs.SnapshotId,
      volumeType: 'gp3',
      volumeSizeGiB: rootEbs.VolumeSize,
      encrypted: false,
      deleteOnTermination: true,
    },
  });
}

export default {
  AwsSingleNodeMachineImageEvidenceConflictError,
  AwsSingleNodeMachineImageEvidenceTransientError,
  AwsSingleNodeMachineImageEvidenceUnknownError,
  decodeAwsSingleNodeExactMachineImageParameterResponse,
  decodeAwsSingleNodeExactMachineImageResponse,
};
