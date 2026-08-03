/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider-evidence contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { createCanonicalJsonSha256Id, sha256Base64Url } from './content-id.js';
import { validateAwsSingleNodeProviderSpec } from './deployment-aws-provider-spec.js';

export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DISCOVERY_MAX_RESULTS = 100;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-internet-gateway-attachment-state:v1';
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN =
  'wharfie:aws-single-node-ec2-internet-gateway-attachment:v1';
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX =
  'wia1';
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_INTERNET_GATEWAY_ID_PATTERN =
  /^igw-[0-9a-f]{8,32}$/;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_VPC_ID_PATTERN =
  /^vpc-[0-9a-f]{8,32}$/;

const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const INTERNET_GATEWAY_ATTACHMENT_STATES = new Set([
  'available',
  'attaching',
  'attached',
  'detaching',
  'detached',
]);
const STATE_DESCRIPTOR_KEYS = new Set(['state', 'onDestroy']);

/** Present provider evidence contradicts the exact relationship contract. */
export class AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node internet gateway attachment evidence conflicts with its exact contract.',
    );
    this.name = 'AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError';
    this.code = 'AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_EVIDENCE_CONFLICT';
  }
}

/** Provider evidence is unavailable or structurally inconclusive. */
export class AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError extends Error {
  constructor() {
    super('AWS single-node internet gateway attachment evidence is unknown.');
    this.name = 'AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError';
    this.code = 'AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_EVIDENCE_UNKNOWN';
  }
}

/** Readable provider views have not yet converged on one relationship state. */
export class AwsSingleNodeInternetGatewayAttachmentEvidenceTransientError extends Error {
  constructor() {
    super('AWS single-node internet gateway attachment evidence is transient.');
    this.name = 'AwsSingleNodeInternetGatewayAttachmentEvidenceTransientError';
    this.code =
      'AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_EVIDENCE_TRANSIENT';
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

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertExactKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
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

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeInternetGatewayAttachmentInternetGatewayId(
  value,
) {
  if (
    typeof value !== 'string' ||
    !AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_INTERNET_GATEWAY_ID_PATTERN.test(
      value,
    )
  ) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeInternetGatewayAttachmentVpcId(value) {
  if (
    typeof value !== 'string' ||
    !AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_VPC_ID_PATTERN.test(value)
  ) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeInternetGatewayAttachmentOwnerId(value) {
  if (typeof value !== 'string' || !AWS_ACCOUNT_ID_PATTERN.test(value)) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
  }
  return value;
}

/**
 * Hash one exact logical relationship state.
 * @param {unknown} value - Exact state descriptor.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - State digest.
 */
export function createAwsSingleNodeInternetGatewayAttachmentStateDigest(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeInternetGatewayAttachment state descriptor must be an object.',
    );
  }
  assertExactKeys(
    value,
    STATE_DESCRIPTOR_KEYS,
    'awsSingleNodeInternetGatewayAttachment state descriptor',
  );
  if (value.state !== 'available') {
    throw new TypeError(
      "awsSingleNodeInternetGatewayAttachment state descriptor.state must be 'available'.",
    );
  }
  if (value.onDestroy !== 'purge') {
    throw new TypeError(
      "awsSingleNodeInternetGatewayAttachment state descriptor.onDestroy must be 'purge'.",
    );
  }
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2InternetGatewayAttachmentState',
    state: value.state,
    onDestroy: value.onDestroy,
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/**
 * Derive the one exact desired relationship state.
 * @param {unknown} value - Exact AWS single-node provider specification.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - State digest.
 */
export function getAwsSingleNodeInternetGatewayAttachmentStateDigest(value) {
  validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeInternetGatewayAttachmentState providerSpec',
  );
  return createAwsSingleNodeInternetGatewayAttachmentStateDigest({
    state: 'available',
    onDestroy: 'purge',
  });
}

/** @param {string} internetGatewayId @param {string} vpcId @returns {string} */
export function getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
  internetGatewayId,
  vpcId,
) {
  try {
    validateAwsSingleNodeInternetGatewayAttachmentInternetGatewayId(
      internetGatewayId,
    );
  } catch {
    throw new TypeError(
      'awsSingleNodeInternetGatewayAttachment internetGatewayId must be a canonical EC2 internet gateway ID.',
    );
  }
  try {
    validateAwsSingleNodeInternetGatewayAttachmentVpcId(vpcId);
  } catch {
    throw new TypeError(
      'awsSingleNodeInternetGatewayAttachment vpcId must be a canonical EC2 VPC ID.',
    );
  }
  return createCanonicalJsonSha256Id({
    domain:
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
    prefix:
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
    value: { internetGatewayId, vpcId },
    valuePath: 'awsSingleNodeInternetGatewayAttachment provider identity',
  });
}

/**
 * Decode one strict internet-gateway record without inferring attachment state.
 * @param {unknown} value - Raw DescribeInternetGateways record.
 * @returns {Readonly<Record<string, any>>} - Validated raw record.
 */
export function decodeAwsSingleNodeInternetGatewayAttachmentRecord(value) {
  if (!isPlainObject(value) || !Array.isArray(value.Attachments)) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
  }
  if (value.Attachments.length > 1) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError();
  }
  const internetGatewayId =
    validateAwsSingleNodeInternetGatewayAttachmentInternetGatewayId(
      value.InternetGatewayId,
    );
  const ownerId = validateAwsSingleNodeInternetGatewayAttachmentOwnerId(
    value.OwnerId,
  );
  const attachments = value.Attachments.map((attachment) => {
    if (
      !isPlainObject(attachment) ||
      typeof attachment.State !== 'string' ||
      !INTERNET_GATEWAY_ATTACHMENT_STATES.has(attachment.State)
    ) {
      throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
    }
    return deepFreeze({
      state: attachment.State,
      vpcId: validateAwsSingleNodeInternetGatewayAttachmentVpcId(
        attachment.VpcId,
      ),
    });
  });
  return deepFreeze({
    internetGatewayId,
    ownerId,
    attachments,
    raw: value,
  });
}

/** @param {unknown} response @param {unknown} exactInternetGatewayId @returns {Readonly<Record<string, any>>} */
export function decodeAwsSingleNodeExactInternetGatewayAttachmentResponse(
  response,
  exactInternetGatewayId,
) {
  const expectedId =
    validateAwsSingleNodeInternetGatewayAttachmentInternetGatewayId(
      exactInternetGatewayId,
    );
  if (!isPlainObject(response) || !Array.isArray(response.InternetGateways)) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError();
  }
  if (response.InternetGateways.length === 0) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
  }
  if (response.InternetGateways.length !== 1) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError();
  }
  const record = decodeAwsSingleNodeInternetGatewayAttachmentRecord(
    response.InternetGateways[0],
  );
  if (record.internetGatewayId !== expectedId) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError();
  }
  return record;
}

/** @param {unknown} response @returns {{records: Readonly<Record<string, any>>[], nextToken: string|null}} */
export function decodeAwsSingleNodeInternetGatewayAttachmentDiscoveryPage(
  response,
) {
  if (!isPlainObject(response) || !Array.isArray(response.InternetGateways)) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
  }
  let nextToken = null;
  if (response.NextToken !== undefined && response.NextToken !== null) {
    if (
      typeof response.NextToken !== 'string' ||
      response.NextToken.length === 0
    ) {
      throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
    }
    nextToken = response.NextToken;
  }
  const records = [];
  const ids = new Set();
  for (const internetGateway of response.InternetGateways) {
    const record =
      decodeAwsSingleNodeInternetGatewayAttachmentRecord(internetGateway);
    if (ids.has(record.internetGatewayId)) {
      throw new AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError();
    }
    ids.add(record.internetGatewayId);
    records.push(record);
  }
  return { records, nextToken };
}

/**
 * Classify the exact endpoint view for one dependency-derived relationship.
 * @param {Readonly<Record<string, any>>} record - Decoded exact gateway.
 * @param {unknown} expectedOwnerId - Fixed credential account.
 * @param {unknown} expectedVpcId - Exact VPC dependency.
 * @returns {'present'|'absent'|'transient'} - Logical relationship state.
 */
export function decodeAwsSingleNodeExactInternetGatewayAttachmentState(
  record,
  expectedOwnerId,
  expectedVpcId,
) {
  const ownerId =
    validateAwsSingleNodeInternetGatewayAttachmentOwnerId(expectedOwnerId);
  const vpcId =
    validateAwsSingleNodeInternetGatewayAttachmentVpcId(expectedVpcId);
  if (record.ownerId !== ownerId) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError();
  }
  if (record.attachments.length === 0) return 'absent';
  const attachment = record.attachments[0];
  if (attachment.vpcId !== vpcId) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError();
  }
  return attachment.state === 'available' ? 'present' : 'transient';
}

/**
 * Classify the VPC occupancy view for one dependency-derived relationship.
 * @param {Readonly<Record<string, any>>[]} records - Decoded discovery records.
 * @param {unknown} expectedInternetGatewayId - Exact gateway dependency.
 * @param {unknown} expectedOwnerId - Fixed credential account.
 * @param {unknown} expectedVpcId - Exact VPC dependency.
 * @returns {'present'|'absent'|'transient'} - Logical relationship state.
 */
export function decodeAwsSingleNodeBroadInternetGatewayAttachmentState(
  records,
  expectedInternetGatewayId,
  expectedOwnerId,
  expectedVpcId,
) {
  if (!Array.isArray(records)) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
  }
  const internetGatewayId =
    validateAwsSingleNodeInternetGatewayAttachmentInternetGatewayId(
      expectedInternetGatewayId,
    );
  const ownerId =
    validateAwsSingleNodeInternetGatewayAttachmentOwnerId(expectedOwnerId);
  const vpcId =
    validateAwsSingleNodeInternetGatewayAttachmentVpcId(expectedVpcId);
  if (records.length === 0) return 'absent';
  if (records.length !== 1) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError();
  }
  const record = records[0];
  if (
    record.internetGatewayId !== internetGatewayId ||
    record.ownerId !== ownerId
  ) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError();
  }
  if (record.attachments.length === 0) return 'transient';
  const attachment = record.attachments[0];
  if (attachment.vpcId !== vpcId) {
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError();
  }
  return attachment.state === 'available' ? 'present' : 'transient';
}

/** @param {unknown[]} errors @returns {Error|null} */
export function getAwsSingleNodeInternetGatewayAttachmentStrongestEvidenceError(
  errors,
) {
  if (
    errors.some(
      (error) =>
        error instanceof
        AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError,
    )
  ) {
    return new AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError();
  }
  if (
    errors.some(
      (error) =>
        error instanceof
        AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError,
    )
  ) {
    return new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
  }
  if (
    errors.some(
      (error) =>
        error instanceof
        AwsSingleNodeInternetGatewayAttachmentEvidenceTransientError,
    )
  ) {
    return new AwsSingleNodeInternetGatewayAttachmentEvidenceTransientError();
  }
  return null;
}

export default {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_INTERNET_GATEWAY_ID_PATTERN,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_STATE_DIGEST_DOMAIN,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_VPC_ID_PATTERN,
  AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError,
  AwsSingleNodeInternetGatewayAttachmentEvidenceTransientError,
  AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError,
  createAwsSingleNodeInternetGatewayAttachmentStateDigest,
  decodeAwsSingleNodeBroadInternetGatewayAttachmentState,
  decodeAwsSingleNodeExactInternetGatewayAttachmentResponse,
  decodeAwsSingleNodeExactInternetGatewayAttachmentState,
  decodeAwsSingleNodeInternetGatewayAttachmentDiscoveryPage,
  decodeAwsSingleNodeInternetGatewayAttachmentRecord,
  getAwsSingleNodeInternetGatewayAttachmentProviderResourceId,
  getAwsSingleNodeInternetGatewayAttachmentStateDigest,
  getAwsSingleNodeInternetGatewayAttachmentStrongestEvidenceError,
  validateAwsSingleNodeInternetGatewayAttachmentInternetGatewayId,
  validateAwsSingleNodeInternetGatewayAttachmentOwnerId,
  validateAwsSingleNodeInternetGatewayAttachmentVpcId,
};
