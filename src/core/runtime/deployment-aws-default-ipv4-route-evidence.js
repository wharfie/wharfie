/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider-evidence contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { sha256Base64Url } from './content-id.js';
import {
  decodeAwsSingleNodeInternetGatewayIntrinsicEvidence,
  validateAwsSingleNodeInternetGatewayId,
} from './deployment-aws-internet-gateway-evidence.js';
import {
  decodeAwsSingleNodeRouteTableRecordState,
  validateAwsSingleNodeRouteTableId,
  validateAwsSingleNodeRouteTableVpcId,
} from './deployment-aws-route-table-evidence.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
} from './deployment-aws-tagged-ec2-evidence.js';

export const AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-default-ipv4-route-state:v1';

const STATE_DESCRIPTOR_KEYS = new Set([
  'destinationCidrBlock',
  'targetKind',
  'origin',
  'state',
  'onDestroy',
]);
const ROUTE_EVIDENCE_OPTIONS_KEYS = new Set([
  'destinationCidrBlock',
  'internetGatewayId',
  'routeTableId',
  'vpcCidr',
  'allowSubnetAssociation',
]);
const GATEWAY_EVIDENCE_OPTIONS_KEYS = new Set([
  'internetGatewayId',
  'ownerId',
  'vpcId',
]);
const ROUTE_STATES = new Set(['active', 'blackhole']);
const INTERNET_GATEWAY_ATTACHMENT_STATES = new Set([
  'available',
  'attaching',
  'attached',
  'detaching',
  'detached',
]);
const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;

/** The intrinsic local route is not yet provider-visible. */
export class AwsSingleNodeDefaultIpv4RouteMissingLocalEvidenceError extends AwsTaggedEc2EvidenceTransientError {
  constructor() {
    super();
    this.name = 'AwsSingleNodeDefaultIpv4RouteMissingLocalEvidenceError';
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

/**
 * Hash one normalized provider-observable default IPv4 route.
 * Provider-allocated endpoint IDs remain in dependency lineage.
 * @param {unknown} value - Exact normalized route descriptor.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function createAwsSingleNodeDefaultIpv4RouteStateDigest(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeDefaultIpv4Route state must be an object.',
    );
  }
  assertExactKeys(
    value,
    STATE_DESCRIPTOR_KEYS,
    'awsSingleNodeDefaultIpv4Route state',
  );
  if (
    value.destinationCidrBlock !== '0.0.0.0/0' ||
    value.targetKind !== 'internet-gateway' ||
    value.origin !== 'CreateRoute' ||
    typeof value.state !== 'string' ||
    !ROUTE_STATES.has(value.state) ||
    value.onDestroy !== 'purge'
  ) {
    throw new TypeError(
      'awsSingleNodeDefaultIpv4Route state does not match a supported provider-observable route.',
    );
  }
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2DefaultIpv4RouteState',
    destinationCidrBlock: value.destinationCidrBlock,
    targetKind: value.targetKind,
    origin: value.origin,
    state: value.state,
    onDestroy: value.onDestroy,
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/**
 * Decode the exact route-table natural slot without applying controller state.
 * One later managed subnet association is a separate supported descendant.
 * @param {unknown} value - One exact DescribeRouteTables record.
 * @param {unknown} options - Exact route endpoints and descendant policy.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeDefaultIpv4RouteEvidence(value, options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeDefaultIpv4Route evidence options must be an object.',
    );
  }
  assertExactKeys(
    options,
    ROUTE_EVIDENCE_OPTIONS_KEYS,
    'awsSingleNodeDefaultIpv4Route evidence options',
  );
  if (
    options.destinationCidrBlock !== '0.0.0.0/0' ||
    typeof options.vpcCidr !== 'string' ||
    typeof options.allowSubnetAssociation !== 'boolean'
  ) {
    throw new TypeError(
      'awsSingleNodeDefaultIpv4Route evidence options do not match the fixed route contract.',
    );
  }
  const routeTableId = validateAwsSingleNodeRouteTableId(options.routeTableId);
  const internetGatewayId = validateAwsSingleNodeInternetGatewayId(
    options.internetGatewayId,
  );
  const state = decodeAwsSingleNodeRouteTableRecordState(value);
  if (state.providerResourceId !== routeTableId) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  if (
    state.localIpv4Route === null ||
    state.localIpv4Route.destinationCidrBlock !== options.vpcCidr ||
    state.localIpv4Route.gatewayId !== 'local' ||
    state.localIpv4Route.origin !== 'CreateRouteTable' ||
    state.localIpv4Route.state !== 'active'
  ) {
    if (state.localIpv4Route === null) {
      throw new AwsSingleNodeDefaultIpv4RouteMissingLocalEvidenceError();
    }
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  if (
    state.main ||
    state.propagatingVirtualGateways.length !== 0 ||
    state.otherAssociations.length !== 0 ||
    state.otherRoutes.length !== 0 ||
    state.subnetAssociations.length > (options.allowSubnetAssociation ? 1 : 0)
  ) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  const route = state.defaultIpv4Routes[0] ?? null;
  if (route === null) {
    return deepFreeze({
      presence: 'absent',
      providerResourceId: routeTableId,
      observedDigest: null,
    });
  }
  if (
    route.destinationCidrBlock !== options.destinationCidrBlock ||
    route.gatewayId !== internetGatewayId ||
    route.origin !== 'CreateRoute'
  ) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  return deepFreeze({
    presence: 'present',
    providerResourceId: routeTableId,
    observedDigest: createAwsSingleNodeDefaultIpv4RouteStateDigest({
      destinationCidrBlock: route.destinationCidrBlock,
      targetKind: 'internet-gateway',
      origin: route.origin,
      state: route.state,
      onDestroy: 'purge',
    }),
  });
}

/**
 * Decode the exact gateway endpoint and its shared-VPC attachment state.
 * Tags remain mode-specific evidence owned by the caller's direct-resource
 * kernel.
 * @param {unknown} value - One exact DescribeInternetGateways record.
 * @param {unknown} options - Exact gateway, account, and VPC identity.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeDefaultIpv4RouteGatewayEvidence(
  value,
  options,
) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeDefaultIpv4Route gateway evidence options must be an object.',
    );
  }
  assertExactKeys(
    options,
    GATEWAY_EVIDENCE_OPTIONS_KEYS,
    'awsSingleNodeDefaultIpv4Route gateway evidence options',
  );
  const internetGatewayId = validateAwsSingleNodeInternetGatewayId(
    options.internetGatewayId,
  );
  const vpcId = validateAwsSingleNodeRouteTableVpcId(options.vpcId);
  if (
    typeof options.ownerId !== 'string' ||
    !AWS_ACCOUNT_ID_PATTERN.test(options.ownerId)
  ) {
    throw new TypeError(
      'awsSingleNodeDefaultIpv4Route gateway evidence ownerId must be a 12-digit AWS account ID.',
    );
  }
  const intrinsic = decodeAwsSingleNodeInternetGatewayIntrinsicEvidence(
    value,
    options.ownerId,
  );
  if (intrinsic.providerResourceId !== internetGatewayId) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  if (
    !isPlainObject(value) ||
    !Array.isArray(
      /** @type {Readonly<Record<string, any>>} */ (value).Attachments,
    )
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const attachments = /** @type {Readonly<Record<string, any>>} */ (value)
    .Attachments;
  if (attachments.length > 1) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  if (attachments.length === 0) {
    return deepFreeze({
      providerResourceId: internetGatewayId,
      attachment: 'absent',
    });
  }
  const attachment = attachments[0];
  if (
    !isPlainObject(attachment) ||
    typeof attachment.State !== 'string' ||
    !INTERNET_GATEWAY_ATTACHMENT_STATES.has(attachment.State)
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  let attachmentVpcId;
  try {
    attachmentVpcId = validateAwsSingleNodeRouteTableVpcId(attachment.VpcId);
  } catch {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (attachmentVpcId !== vpcId) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  return deepFreeze({
    providerResourceId: internetGatewayId,
    attachment: attachment.State === 'available' ? 'available' : 'transitional',
  });
}

export default {
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_STATE_DIGEST_DOMAIN,
  AwsSingleNodeDefaultIpv4RouteMissingLocalEvidenceError,
  createAwsSingleNodeDefaultIpv4RouteStateDigest,
  decodeAwsSingleNodeDefaultIpv4RouteEvidence,
  decodeAwsSingleNodeDefaultIpv4RouteGatewayEvidence,
};
