/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider-evidence contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { sha256Base64Url } from './content-id.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceUnknownError,
  createAwsTaggedEc2EvidenceKernel,
} from './deployment-aws-tagged-ec2-evidence.js';

export const AWS_SINGLE_NODE_INTERNET_GATEWAY_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_DISCOVERY_MAX_RESULTS = 100;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-internet-gateway-state:v1';
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ID_PATTERN =
  /^igw-[0-9a-f]{8,32}$/;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_TAGS = 50;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_BASE_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-internet-gateway',
  'wharfie:retention': 'purge',
  'wharfie:schema-version': '2',
});

const EVIDENCE_FACTORY_KEYS = new Set(['readDiscoveryPage', 'readExact']);

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
export function validateAwsSingleNodeInternetGatewayId(value) {
  if (
    typeof value !== 'string' ||
    !AWS_SINGLE_NODE_INTERNET_GATEWAY_ID_PATTERN.test(value)
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return value;
}

/**
 * Hash the intrinsic standalone gateway state. VPC attachment is deliberately
 * excluded because the graph owns it as a separate derived resource.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function createAwsSingleNodeInternetGatewayStateDigest() {
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2InternetGatewayState',
    onDestroy: 'purge',
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_INTERNET_GATEWAY_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/** @param {unknown} response @param {string} exactInternetGatewayId @returns {Readonly<Record<string, any>>} */
export function decodeAwsSingleNodeExactInternetGatewayResponse(
  response,
  exactInternetGatewayId,
) {
  const expectedId = validateAwsSingleNodeInternetGatewayId(
    exactInternetGatewayId,
  );
  if (!isPlainObject(response) || !Array.isArray(response.InternetGateways)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  if (response.InternetGateways.length === 0) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (response.InternetGateways.length !== 1) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  const internetGateway = response.InternetGateways[0];
  if (!isPlainObject(internetGateway)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (
    validateAwsSingleNodeInternetGatewayId(
      internetGateway.InternetGatewayId,
    ) !== expectedId
  ) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  return internetGateway;
}

/** @param {unknown} response @returns {{records: Readonly<Record<string, any>>[], nextToken: string|null}} */
export function decodeAwsSingleNodeInternetGatewayDiscoveryPage(response) {
  if (!isPlainObject(response) || !Array.isArray(response.InternetGateways)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  let nextToken = null;
  if (response.NextToken !== undefined && response.NextToken !== null) {
    if (
      typeof response.NextToken !== 'string' ||
      response.NextToken.length === 0
    ) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    nextToken = response.NextToken;
  }
  const records = [];
  for (const internetGateway of response.InternetGateways) {
    if (!isPlainObject(internetGateway)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    validateAwsSingleNodeInternetGatewayId(internetGateway.InternetGatewayId);
    records.push(internetGateway);
  }
  return { records, nextToken };
}

/**
 * Validate only intrinsic gateway identity and account ownership. Tags are
 * validated by the shared evidence kernel against mode-specific authority.
 * Attachment state is intentionally not interpreted here.
 * @param {unknown} value - Candidate exact or discovered gateway record.
 * @param {string} expectedOwnerId - Credential-scope AWS account ID.
 * @returns {Readonly<{providerResourceId: string, observedDigest: Readonly<{algorithm: 'sha256', value: string}>}>}
 */
export function decodeAwsSingleNodeInternetGatewayIntrinsicEvidence(
  value,
  expectedOwnerId,
) {
  if (!isPlainObject(value)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const providerResourceId = validateAwsSingleNodeInternetGatewayId(
    value.InternetGatewayId,
  );
  if (typeof value.OwnerId !== 'string') {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (value.OwnerId !== expectedOwnerId) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  return deepFreeze({
    providerResourceId,
    observedDigest: createAwsSingleNodeInternetGatewayStateDigest(),
  });
}

/**
 * Bind the pure shared tagged-EC2 evidence mechanics to internet-gateway
 * identity, pagination, and tag limits.
 * @param {unknown} options - Exact discovery-page and exact-ID read adapters.
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeInternetGatewayEvidenceKernel(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeInternetGatewayEvidence options must be an object.',
    );
  }
  assertExactKeys(
    options,
    EVIDENCE_FACTORY_KEYS,
    'awsSingleNodeInternetGatewayEvidence options',
  );
  return createAwsTaggedEc2EvidenceKernel({
    baseTags: AWS_SINGLE_NODE_INTERNET_GATEWAY_BASE_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_INTERNET_GATEWAY_DISCOVERY_MAX_RESULTS,
    idKey: 'InternetGatewayId',
    idPattern: AWS_SINGLE_NODE_INTERNET_GATEWAY_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_DISCOVERY_PAGES,
    maxTags: AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_TAGS,
    readDiscoveryPage: options.readDiscoveryPage,
    readExact: options.readExact,
  });
}

export default {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_BASE_TAGS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ID_PATTERN,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_TAGS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_STATE_DIGEST_DOMAIN,
  createAwsSingleNodeInternetGatewayEvidenceKernel,
  createAwsSingleNodeInternetGatewayStateDigest,
  decodeAwsSingleNodeExactInternetGatewayResponse,
  decodeAwsSingleNodeInternetGatewayDiscoveryPage,
  decodeAwsSingleNodeInternetGatewayIntrinsicEvidence,
  validateAwsSingleNodeInternetGatewayId,
};
