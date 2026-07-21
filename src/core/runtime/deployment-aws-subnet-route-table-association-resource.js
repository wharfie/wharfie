/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import { createCanonicalJsonSha256Id, sha256Base64Url } from './content-id.js';
import {
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_PREFIX,
  getAwsSingleNodeDefaultIpv4RouteStateDigest,
} from './deployment-aws-default-ipv4-route-resource.js';
import {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
  getAwsSingleNodeInternetGatewayAttachmentStateDigest,
} from './deployment-aws-internet-gateway-attachment-resource.js';
import { getAwsSingleNodeInternetGatewayStateDigest } from './deployment-aws-internet-gateway-resource.js';
import {
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import { getAwsSingleNodeRouteTableStateDigest } from './deployment-aws-route-table-resource.js';
import { getAwsSingleNodeSubnetStateDigest } from './deployment-aws-subnet-resource.js';
import { getAwsSingleNodeVpcStateDigest } from './deployment-aws-vpc-resource.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';

export const AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DISCOVERY_MAX_RESULTS = 100;
export const AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-subnet-route-table-association-state:v1';
export const AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_DOMAIN =
  'wharfie:aws-single-node-ec2-subnet-route-table-association:v1';
export const AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_PREFIX =
  'wsa1';

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const ACTION_CONTEXT_KEYS = new Set([
  'operation',
  'plan',
  'action',
  'actionIndex',
  'ownershipNonce',
  'head',
  'profile',
  'artifactStage',
]);
const REQUIRED_CLIENT_METHODS = Object.freeze([
  'associateRouteTable',
  'describeRouteTables',
  'describeSubnets',
  'disassociateRouteTable',
]);
const RESOURCE_KEY = 'network-subnet-route-table-association';
const PROVIDER_TYPE = 'ec2-subnet-route-table-association';
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const INTERNET_GATEWAY_ID_PATTERN = /^igw-[0-9a-f]{8,32}$/;
const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,32}$/;
const ROUTE_TABLE_ID_PATTERN = /^rtb-[0-9a-f]{8,32}$/;
const ROUTE_TABLE_ASSOCIATION_ID_PATTERN = /^rtbassoc-[0-9a-f]{8,32}$/;
const SUBNET_CIDR_ASSOCIATION_ID_PATTERN = /^subnet-cidr-assoc-[0-9a-f]{8,32}$/;
const SUBNET_STATES = new Set([
  'pending',
  'available',
  'unavailable',
  'failed',
  'failed-insufficient-capacity',
]);
const ROUTE_ASSOCIATION_STATES = new Set([
  'associating',
  'associated',
  'disassociating',
  'disassociated',
  'failed',
]);
const ROUTE_STATES = new Set(['active', 'blackhole']);
const ROUTE_ORIGINS = new Set([
  'Advertisement',
  'CreateRoute',
  'CreateRouteTable',
  'EnableVgwRoutePropagation',
]);
const ROUTE_DESTINATION_KEYS = Object.freeze([
  'DestinationCidrBlock',
  'DestinationIpv6CidrBlock',
  'DestinationPrefixListId',
]);
const ROUTE_TARGET_KEYS = Object.freeze([
  'CarrierGatewayId',
  'CoreNetworkArn',
  'EgressOnlyInternetGatewayId',
  'GatewayId',
  'InstanceId',
  'IpAddress',
  'LocalGatewayId',
  'NatGatewayId',
  'NetworkInterfaceId',
  'OdbNetworkArn',
  'TransitGatewayId',
  'VpcPeeringConnectionId',
]);
const MAX_PARENT_TAGS = 50;
const DEPENDENCY_KEYS = Object.freeze([
  'network-subnet',
  'network-route-table',
  'network-default-ipv4-route',
]);
const RECEIPT_DEFINITIONS = Object.freeze([
  Object.freeze({
    resourceKey: 'network-vpc',
    providerType: 'ec2-vpc',
    role: Object.freeze({ kind: 'vpc', version: 1 }),
    ownershipMode: 'direct',
    dependsOn: Object.freeze([]),
    idPattern: VPC_ID_PATTERN,
  }),
  Object.freeze({
    resourceKey: 'network-internet-gateway',
    providerType: 'ec2-internet-gateway',
    role: Object.freeze({ kind: 'internet-gateway', version: 1 }),
    ownershipMode: 'direct',
    dependsOn: Object.freeze([]),
    idPattern: INTERNET_GATEWAY_ID_PATTERN,
  }),
  Object.freeze({
    resourceKey: 'network-internet-gateway-attachment',
    providerType: 'ec2-internet-gateway-attachment',
    role: Object.freeze({ kind: 'internet-gateway-attachment', version: 1 }),
    ownershipMode: 'derived',
    dependsOn: Object.freeze(['network-vpc', 'network-internet-gateway']),
    idPattern: null,
  }),
  Object.freeze({
    resourceKey: 'network-subnet',
    providerType: 'ec2-subnet',
    role: Object.freeze({ kind: 'subnet', version: 1 }),
    ownershipMode: 'direct',
    dependsOn: Object.freeze(['network-vpc']),
    idPattern: SUBNET_ID_PATTERN,
  }),
  Object.freeze({
    resourceKey: 'network-route-table',
    providerType: 'ec2-route-table',
    role: Object.freeze({ kind: 'route-table', version: 1 }),
    ownershipMode: 'direct',
    dependsOn: Object.freeze(['network-vpc']),
    idPattern: ROUTE_TABLE_ID_PATTERN,
  }),
  Object.freeze({
    resourceKey: 'network-default-ipv4-route',
    providerType: 'ec2-ipv4-route',
    role: Object.freeze({ kind: 'default-ipv4-route', version: 1 }),
    ownershipMode: 'derived',
    dependsOn: Object.freeze([
      'network-internet-gateway-attachment',
      'network-route-table',
    ]),
    idPattern: null,
  }),
]);

/** Exact controller authority or present provider evidence is contradictory. */
export class AwsSingleNodeSubnetRouteTableAssociationResourceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node subnet route-table association conflicts with its exact contract.',
    );
    this.name = 'AwsSingleNodeSubnetRouteTableAssociationResourceConflictError';
    this.code =
      'AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node subnet route-table association state is unknown.');
    this.name = 'AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError';
    this.code =
      'AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_RESOURCE_UNKNOWN';
  }
}

class ProviderResponseUnknownError extends Error {}
class SubnetRouteTableAssociationEvidenceConflictError extends Error {}
class SubnetRouteTableAssociationEvidenceTransientError extends Error {}

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

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameDependencyBindings(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every(
      (dependency, index) =>
        dependency.resourceKey === right[index]?.resourceKey &&
        dependency.bindingId === right[index]?.bindingId,
    )
  );
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
function subnetNotFound(error) {
  return (
    errorNamed(error, 'InvalidSubnetID.NotFound') ||
    errorNamed(error, 'InvalidSubnetId.NotFound')
  );
}

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Derive the fixed logical relationship state. Provider-allocated endpoint
 * and association IDs belong to binding lineage and provider evidence.
 * @param {unknown} value - Exact AWS single-node provider specification.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - State digest.
 */
export function getAwsSingleNodeSubnetRouteTableAssociationStateDigest(value) {
  validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeSubnetRouteTableAssociationState providerSpec',
  );
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2SubnetRouteTableAssociationState',
    associationType: 'explicit-subnet',
    main: false,
    state: 'associated',
    onDestroy: 'purge',
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/** @param {string} internetGatewayId @param {string} vpcId @returns {string} */
function internetGatewayAttachmentProviderResourceId(internetGatewayId, vpcId) {
  return createCanonicalJsonSha256Id({
    domain:
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
    prefix:
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
    value: { internetGatewayId, vpcId },
    valuePath: 'awsSingleNodeInternetGatewayAttachment provider identity',
  });
}

/** @param {string} destinationCidrBlock @param {string} internetGatewayId @param {string} routeTableId @returns {string} */
function defaultIpv4RouteProviderResourceId(
  destinationCidrBlock,
  internetGatewayId,
  routeTableId,
) {
  return createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_PREFIX,
    value: { destinationCidrBlock, internetGatewayId, routeTableId },
    valuePath: 'awsSingleNodeDefaultIpv4Route provider identity',
  });
}

/** @param {string} routeTableId @param {string} subnetId @returns {string} */
function providerResourceId(routeTableId, subnetId) {
  return createCanonicalJsonSha256Id({
    domain:
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_DOMAIN,
    prefix:
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_PREFIX,
    value: { routeTableId, subnetId },
    valuePath: 'awsSingleNodeSubnetRouteTableAssociation provider identity',
  });
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} definition @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} providerScope @returns {boolean} */
function receiptBindingMatches(binding, definition, plan, providerScope) {
  return (
    binding.management === 'managed' &&
    binding.providerType === definition.providerType &&
    (definition.idPattern === null ||
      definition.idPattern.test(binding.providerResourceId)) &&
    binding.deploymentInstanceId === plan.deploymentInstanceId &&
    binding.resourceKey === definition.resourceKey &&
    binding.providerScopeId === providerScope.providerScopeId &&
    binding.incarnationId === plan.incarnationId &&
    sameJson(binding.capability, { kind: 'networking', version: 1 }) &&
    sameJson(binding.role, definition.role) &&
    binding.ownershipMode === definition.ownershipMode &&
    binding.onDestroy === 'purge'
  );
}

/** @param {Readonly<Record<string, any>>[]} bindings @returns {Readonly<Array<{resourceKey: string, bindingId: string}>>} */
function dependencyReceipts(bindings) {
  return bindings
    .map((binding) => ({
      resourceKey: binding.resourceKey,
      bindingId: binding.bindingId,
    }))
    .sort((left, right) =>
      compareCanonicalStrings(left.resourceKey, right.resourceKey),
    );
}

/**
 * Resolve all declared receipts and their VPC/IGW lineage. Apply dependencies
 * are settled earlier; reverse-destroy dependencies remain pending later.
 * @param {Readonly<Record<string, any>>} plan - Exact immutable action plan.
 * @param {Readonly<Record<string, any>>} head - Current durable authority.
 * @param {number} actionIndex - Current intended action index.
 * @param {Readonly<Record<string, any>>} providerScope - Fixed AWS scope.
 * @param {Readonly<Record<string, any>>} providerSpec - Fixed provider intent.
 * @returns {Readonly<Record<string, any>>}
 */
function resolveDependencyAuthority(
  plan,
  head,
  actionIndex,
  providerScope,
  providerSpec,
) {
  const resolved = new Map();
  const resolvedActions = new Map();
  for (const definition of RECEIPT_DEFINITIONS) {
    const dependencyActionIndex = plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === definition.resourceKey,
    );
    const dependencyAction = plan.actions[dependencyActionIndex];
    const dependencyIntent =
      head.activeOperation.intents[dependencyActionIndex];
    const binding = head.resourceBindings.find(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === definition.resourceKey,
    );
    const applyAuthority =
      plan.operation !== 'destroy' &&
      dependencyActionIndex >= 0 &&
      dependencyActionIndex < actionIndex &&
      dependencyIntent?.status === 'settled' &&
      dependencyAction?.after !== null &&
      dependencyAction?.after !== undefined &&
      dependencyAction.after.providerType === definition.providerType &&
      (dependencyAction.after.providerResourceId === null ||
        dependencyAction.after.providerResourceId ===
          binding?.providerResourceId);
    const destroyAuthority =
      plan.operation === 'destroy' &&
      dependencyActionIndex > actionIndex &&
      dependencyIntent?.status === 'pending' &&
      dependencyAction?.action === 'delete' &&
      dependencyAction.before !== null &&
      dependencyAction.before.providerType === definition.providerType &&
      dependencyAction.before.providerResourceId ===
        binding?.providerResourceId;
    if (
      binding === undefined ||
      dependencyAction === undefined ||
      dependencyIntent === undefined ||
      (!applyAuthority && !destroyAuthority) ||
      dependencyIntent.actionId !== dependencyAction.actionId ||
      dependencyIntent.ownershipNonce !== binding.ownershipNonce ||
      !receiptBindingMatches(binding, definition, plan, providerScope) ||
      !sameJson(dependencyAction.capability, {
        kind: 'networking',
        version: 1,
      }) ||
      !sameJson(dependencyAction.role, definition.role) ||
      dependencyAction.management !== 'managed' ||
      dependencyAction.ownershipMode !== definition.ownershipMode ||
      dependencyAction.onDestroy !== 'purge' ||
      !sameJson(dependencyAction.dependsOn, definition.dependsOn) ||
      (definition.dependsOn.length === 0 &&
        binding.dependencyBindings.length !== 0) ||
      (dependencyAction.action === 'create' &&
        binding.createdByActionId !== dependencyAction.actionId)
    ) {
      throw new AwsSingleNodeSubnetRouteTableAssociationResourceConflictError();
    }
    resolved.set(definition.resourceKey, binding);
    resolvedActions.set(definition.resourceKey, dependencyAction);
  }

  const vpcBinding = resolved.get('network-vpc');
  const internetGatewayBinding = resolved.get('network-internet-gateway');
  const attachmentBinding = resolved.get('network-internet-gateway-attachment');
  const subnetBinding = resolved.get('network-subnet');
  const routeTableBinding = resolved.get('network-route-table');
  const defaultRouteBinding = resolved.get('network-default-ipv4-route');
  const attachmentAction = resolvedActions.get(
    'network-internet-gateway-attachment',
  );
  const subnetAction = resolvedActions.get('network-subnet');
  const routeTableAction = resolvedActions.get('network-route-table');
  const defaultRouteAction = resolvedActions.get('network-default-ipv4-route');
  if (
    vpcBinding === undefined ||
    internetGatewayBinding === undefined ||
    attachmentBinding === undefined ||
    subnetBinding === undefined ||
    routeTableBinding === undefined ||
    defaultRouteBinding === undefined ||
    attachmentAction === undefined ||
    subnetAction === undefined ||
    routeTableAction === undefined ||
    defaultRouteAction === undefined
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceConflictError();
  }

  const attachmentDependencies = dependencyReceipts([
    vpcBinding,
    internetGatewayBinding,
  ]);
  const vpcDependencies = dependencyReceipts([vpcBinding]);
  const defaultRouteDependencies = dependencyReceipts([
    attachmentBinding,
    routeTableBinding,
  ]);
  const expectedAttachmentProviderResourceId =
    internetGatewayAttachmentProviderResourceId(
      internetGatewayBinding.providerResourceId,
      vpcBinding.providerResourceId,
    );
  const destinationCidrBlock = providerSpec.capabilities.networking.egressCidr;
  const expectedDefaultRouteProviderResourceId =
    defaultIpv4RouteProviderResourceId(
      destinationCidrBlock,
      internetGatewayBinding.providerResourceId,
      routeTableBinding.providerResourceId,
    );
  const expectedDigests = {
    'network-vpc': getAwsSingleNodeVpcStateDigest(providerSpec),
    'network-internet-gateway':
      getAwsSingleNodeInternetGatewayStateDigest(providerSpec),
    'network-internet-gateway-attachment':
      getAwsSingleNodeInternetGatewayAttachmentStateDigest(providerSpec),
    'network-subnet': getAwsSingleNodeSubnetStateDigest(providerSpec),
    'network-route-table': getAwsSingleNodeRouteTableStateDigest(providerSpec),
    'network-default-ipv4-route':
      getAwsSingleNodeDefaultIpv4RouteStateDigest(providerSpec),
  };
  for (const [resourceKey, expectedDigest] of Object.entries(expectedDigests)) {
    const dependencyAction = resolvedActions.get(resourceKey);
    const observedDigest =
      plan.operation === 'destroy'
        ? dependencyAction?.before?.stateDigest
        : dependencyAction?.after?.stateDigest;
    if (!sameJson(observedDigest, expectedDigest)) {
      throw new AwsSingleNodeSubnetRouteTableAssociationResourceConflictError();
    }
  }
  if (
    attachmentBinding.providerResourceId !==
      expectedAttachmentProviderResourceId ||
    defaultRouteBinding.providerResourceId !==
      expectedDefaultRouteProviderResourceId ||
    !sameDependencyBindings(
      attachmentBinding.dependencyBindings,
      attachmentDependencies,
    ) ||
    !sameDependencyBindings(
      subnetBinding.dependencyBindings,
      vpcDependencies,
    ) ||
    !sameDependencyBindings(
      routeTableBinding.dependencyBindings,
      vpcDependencies,
    ) ||
    !sameDependencyBindings(
      defaultRouteBinding.dependencyBindings,
      defaultRouteDependencies,
    )
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceConflictError();
  }

  const dependencyBindings = dependencyReceipts([
    subnetBinding,
    routeTableBinding,
    defaultRouteBinding,
  ]);
  const routeTableId = routeTableBinding.providerResourceId;
  const subnetId = subnetBinding.providerResourceId;
  return deepFreeze({
    vpcBinding,
    internetGatewayBinding,
    attachmentBinding,
    subnetBinding,
    routeTableBinding,
    defaultRouteBinding,
    subnetStateDigest: expectedDigests['network-subnet'],
    routeTableStateDigest: expectedDigests['network-route-table'],
    dependencyBindings,
    destinationCidrBlock,
    internetGatewayId: internetGatewayBinding.providerResourceId,
    routeTableId,
    subnetId,
    vpcId: vpcBinding.providerResourceId,
    providerResourceId: providerResourceId(routeTableId, subnetId),
  });
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} providerScope @param {string} ownershipNonce @param {Readonly<Record<string, any>>} dependencies @returns {boolean} */
function bindingMatchesAuthority(
  binding,
  action,
  plan,
  providerScope,
  ownershipNonce,
  dependencies,
) {
  return (
    binding.management === 'managed' &&
    binding.providerType === PROVIDER_TYPE &&
    binding.providerResourceId === dependencies.providerResourceId &&
    binding.deploymentInstanceId === plan.deploymentInstanceId &&
    binding.resourceKey === RESOURCE_KEY &&
    binding.providerScopeId === providerScope.providerScopeId &&
    binding.incarnationId === plan.incarnationId &&
    sameJson(binding.capability, action.capability) &&
    sameJson(binding.role, action.role) &&
    binding.ownershipMode === 'derived' &&
    binding.onDestroy === 'purge' &&
    sameDependencyBindings(
      binding.dependencyBindings,
      dependencies.dependencyBindings,
    ) &&
    binding.ownershipNonce === ownershipNonce &&
    action.before !== null &&
    action.before.providerType === PROVIDER_TYPE &&
    action.before.providerResourceId === binding.providerResourceId
  );
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>} */
function validateActionContext(value, providerScope) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeSubnetRouteTableAssociation action context must be an object.',
    );
  }
  assertExactKeys(
    value,
    ACTION_CONTEXT_KEYS,
    'awsSingleNodeSubnetRouteTableAssociation context',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeSubnetRouteTableAssociation context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeSubnetRouteTableAssociation context.head',
  );
  const expectedOperationKind =
    plan.operation === 'destroy'
      ? 'destroy'
      : head.settledDeploymentRevisionId === null
        ? 'create'
        : head.settledDeploymentRevisionId ===
            plan.deploymentRevision.deploymentRevisionId
          ? 'reconcile'
          : 'update';
  if (
    value.operation !== plan.operation ||
    plan.providerScope.providerScopeId !== providerScope.providerScopeId ||
    canonicalProviderSpec.providerSpecId !== plan.providerSpec.providerSpecId ||
    head.deploymentInstanceId !== plan.deploymentInstanceId ||
    head.incarnationId !== plan.incarnationId ||
    head.providerScope.providerScopeId !== providerScope.providerScopeId ||
    head.activeOperation === null ||
    head.activeOperation.planId !== plan.planId ||
    head.activeOperation.status !== 'running' ||
    head.activeOperation.kind !== expectedOperationKind ||
    plan.basis.headGeneration >= head.generation ||
    plan.basis.settledDeploymentRevisionId !==
      head.settledDeploymentRevisionId ||
    head.targetDeploymentRevisionId !==
      (expectedOperationKind === 'destroy'
        ? null
        : plan.deploymentRevision.deploymentRevisionId) ||
    head.activeOperation.intents.length !== plan.actions.length ||
    head.activeOperation.intents.some(
      (
        /** @type {Readonly<Record<string, any>>} */ candidate,
        /** @type {number} */ index,
      ) => candidate.actionId !== plan.actions[index].actionId,
    )
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.resourceKey !== RESOURCE_KEY ||
    !sameJson(action.capability, { kind: 'networking', version: 1 }) ||
    !sameJson(action.role, {
      kind: 'subnet-route-table-association',
      version: 1,
    }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'derived' ||
    action.onDestroy !== 'purge' ||
    !sameJson(action.dependsOn, DEPENDENCY_KEYS)
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeSubnetRouteTableAssociation context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceConflictError();
  }
  const dependencies = resolveDependencyAuthority(
    plan,
    head,
    value.actionIndex,
    providerScope,
    canonicalProviderSpec,
  );
  const stateDigest = getAwsSingleNodeSubnetRouteTableAssociationStateDigest(
    canonicalProviderSpec,
  );
  const priorBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === action.resourceKey,
  );
  if (action.action === 'create') {
    if (
      plan.operation === 'destroy' ||
      action.before !== null ||
      action.after === null ||
      action.after.providerType !== PROVIDER_TYPE ||
      action.after.providerResourceId !== null ||
      !sameJson(action.after.stateDigest, stateDigest) ||
      priorBinding !== undefined
    ) {
      throw new AwsSingleNodeSubnetRouteTableAssociationResourceConflictError();
    }
  } else if (action.action === 'noop') {
    if (
      plan.operation === 'destroy' ||
      action.before === null ||
      action.after === null ||
      priorBinding === undefined ||
      !bindingMatchesAuthority(
        priorBinding,
        action,
        plan,
        providerScope,
        ownershipNonce,
        dependencies,
      ) ||
      !sameJson(action.before.stateDigest, stateDigest) ||
      action.after.providerType !== PROVIDER_TYPE ||
      action.after.providerResourceId !== priorBinding.providerResourceId ||
      !sameJson(action.after.stateDigest, stateDigest)
    ) {
      throw new AwsSingleNodeSubnetRouteTableAssociationResourceConflictError();
    }
  } else if (action.action === 'delete') {
    if (
      plan.operation !== 'destroy' ||
      action.after !== null ||
      priorBinding === undefined ||
      !bindingMatchesAuthority(
        priorBinding,
        action,
        plan,
        providerScope,
        ownershipNonce,
        dependencies,
      ) ||
      action.before.stateDigest === null
    ) {
      throw new AwsSingleNodeSubnetRouteTableAssociationResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceConflictError();
  }
  return deepFreeze({
    operation: plan.operation,
    plan,
    action,
    actionIndex: value.actionIndex,
    ownershipNonce,
    head,
    profile,
    providerSpec: canonicalProviderSpec,
    stateDigest,
    priorBinding: priorBinding ?? null,
    ...dependencies,
  });
}

/** @param {Readonly<Record<string, any>>} authority @param {'subnet'|'route-table'} kind @returns {Readonly<Record<string, string>>} */
function expectedParentTags(authority, kind) {
  const subnet = kind === 'subnet';
  const binding = subnet
    ? authority.subnetBinding
    : authority.routeTableBinding;
  const stateDigest = subnet
    ? authority.subnetStateDigest
    : authority.routeTableStateDigest;
  return deepFreeze({
    'wharfie:managed-by': 'wharfie',
    'wharfie:resource-kind': subnet
      ? 'single-node-subnet'
      : 'single-node-route-table',
    'wharfie:retention': 'purge',
    'wharfie:schema-version': '2',
    'wharfie:capability': 'networking',
    'wharfie:role': kind,
    'wharfie:provider-scope-id': authority.plan.providerScope.providerScopeId,
    'wharfie:deployment-instance-id': authority.plan.deploymentInstanceId,
    'wharfie:incarnation-id': authority.plan.incarnationId,
    'wharfie:resource-key': subnet ? 'network-subnet' : 'network-route-table',
    'wharfie:created-by-action-id': binding.createdByActionId,
    'wharfie:ownership-nonce': binding.ownershipNonce,
    'wharfie:state-digest': stateDigest.value,
  });
}

/** @param {unknown} value @param {Readonly<Record<string, string>>} expected @returns {void} */
function validateParentTags(value, expected) {
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  if (value.length > MAX_PARENT_TAGS) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  const observed = new Map();
  for (const tag of value) {
    if (
      !isPlainObject(tag) ||
      typeof tag.Key !== 'string' ||
      tag.Key.length === 0 ||
      typeof tag.Value !== 'string'
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (observed.has(tag.Key)) {
      throw new SubnetRouteTableAssociationEvidenceConflictError();
    }
    observed.set(tag.Key, tag.Value);
  }
  for (const [key, value] of observed) {
    const reserved = Object.hasOwn(expected, key);
    if (key.startsWith('wharfie:') && !reserved) {
      throw new SubnetRouteTableAssociationEvidenceConflictError();
    }
    if (reserved && expected[key] !== value) {
      throw new SubnetRouteTableAssociationEvidenceConflictError();
    }
  }
  if (
    !Object.entries(expected).every(
      ([key, value]) => observed.get(key) === value,
    )
  ) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
}

/** @param {unknown} value @returns {void} */
function validateIpv6Associations(value) {
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  if (value.length === 0) return;
  for (const association of value) {
    if (
      !isPlainObject(association) ||
      typeof association.AssociationId !== 'string' ||
      !SUBNET_CIDR_ASSOCIATION_ID_PATTERN.test(association.AssociationId) ||
      typeof association.Ipv6CidrBlock !== 'string' ||
      association.Ipv6CidrBlock.length === 0 ||
      !isPlainObject(association.Ipv6CidrBlockState) ||
      typeof association.Ipv6CidrBlockState.State !== 'string' ||
      (association.Ipv6CidrBlockState.StatusMessage !== undefined &&
        association.Ipv6CidrBlockState.StatusMessage !== null &&
        typeof association.Ipv6CidrBlockState.StatusMessage !== 'string')
    ) {
      throw new ProviderResponseUnknownError();
    }
  }
  throw new SubnetRouteTableAssociationEvidenceConflictError();
}

/** @param {unknown} value @returns {void} */
function validateBlockPublicAccessStates(value) {
  if (
    !isPlainObject(value) ||
    typeof value.InternetGatewayBlockMode !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (value.InternetGatewayBlockMode === 'off') return;
  if (
    value.InternetGatewayBlockMode === 'block-ingress' ||
    value.InternetGatewayBlockMode === 'block-bidirectional'
  ) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  throw new ProviderResponseUnknownError();
}

/** @param {unknown} response @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function oneSubnetFromResponse(response, authority) {
  if (!isPlainObject(response) || !Array.isArray(response.Subnets)) {
    throw new ProviderResponseUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  if (response.Subnets.length === 0) {
    throw new ProviderResponseUnknownError();
  }
  if (response.Subnets.length !== 1) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  const subnet = response.Subnets[0];
  if (
    !isPlainObject(subnet) ||
    typeof subnet.SubnetId !== 'string' ||
    !SUBNET_ID_PATTERN.test(subnet.SubnetId) ||
    typeof subnet.OwnerId !== 'string' ||
    typeof subnet.VpcId !== 'string' ||
    !VPC_ID_PATTERN.test(subnet.VpcId) ||
    typeof subnet.State !== 'string' ||
    !SUBNET_STATES.has(subnet.State) ||
    typeof subnet.CidrBlock !== 'string' ||
    typeof subnet.AvailabilityZoneId !== 'string' ||
    typeof subnet.DefaultForAz !== 'boolean'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    subnet.SubnetId !== authority.subnetId ||
    subnet.OwnerId !== authority.plan.providerScope.accountId ||
    subnet.VpcId !== authority.vpcId ||
    subnet.CidrBlock !==
      authority.providerSpec.capabilities.networking.subnetCidr ||
    subnet.AvailabilityZoneId !==
      authority.providerSpec.placement.availabilityZoneId ||
    subnet.DefaultForAz
  ) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  validateParentTags(subnet.Tags, expectedParentTags(authority, 'subnet'));
  if (authority.action.action === 'delete') return subnet;
  if (subnet.State === 'pending' || subnet.State === 'unavailable') {
    throw new SubnetRouteTableAssociationEvidenceTransientError();
  }
  if (subnet.State !== 'available') {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  if (
    typeof subnet.Ipv6Native !== 'boolean' ||
    typeof subnet.AssignIpv6AddressOnCreation !== 'boolean' ||
    typeof subnet.MapPublicIpOnLaunch !== 'boolean'
  ) {
    throw new ProviderResponseUnknownError();
  }
  validateIpv6Associations(subnet.Ipv6CidrBlockAssociationSet);
  validateBlockPublicAccessStates(subnet.BlockPublicAccessStates);
  if (
    subnet.Ipv6Native ||
    subnet.AssignIpv6AddressOnCreation ||
    subnet.MapPublicIpOnLaunch
  ) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  return subnet;
}

/** @param {unknown} value @param {string} containerRouteTableId @returns {Readonly<Record<string, any>>} */
function decodeAssociation(value, containerRouteTableId) {
  if (!isPlainObject(value) || typeof value.Main !== 'boolean') {
    throw new ProviderResponseUnknownError();
  }
  if (value.Main) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  if (
    typeof value.RouteTableAssociationId !== 'string' ||
    !ROUTE_TABLE_ASSOCIATION_ID_PATTERN.test(value.RouteTableAssociationId) ||
    typeof value.RouteTableId !== 'string' ||
    !ROUTE_TABLE_ID_PATTERN.test(value.RouteTableId) ||
    !isPlainObject(value.AssociationState) ||
    typeof value.AssociationState.State !== 'string' ||
    !ROUTE_ASSOCIATION_STATES.has(value.AssociationState.State)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    value.AssociationState.StatusMessage !== undefined &&
    value.AssociationState.StatusMessage !== null &&
    typeof value.AssociationState.StatusMessage !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (value.RouteTableId !== containerRouteTableId) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  const subnetPresent = value.SubnetId !== undefined && value.SubnetId !== null;
  const gatewayPresent =
    value.GatewayId !== undefined && value.GatewayId !== null;
  if (
    (subnetPresent &&
      (typeof value.SubnetId !== 'string' ||
        !SUBNET_ID_PATTERN.test(value.SubnetId))) ||
    (gatewayPresent &&
      (typeof value.GatewayId !== 'string' ||
        !/^(?:igw|vgw)-[0-9a-f]{8,32}$/u.test(value.GatewayId)))
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    Number(subnetPresent) + Number(gatewayPresent) !== 1 ||
    (value.PublicIpv4Pool !== undefined && value.PublicIpv4Pool !== null)
  ) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  return value;
}

/** @param {Readonly<Record<string, any>>} route @param {readonly string[]} keys @returns {string[]} */
function populatedRouteFields(route, keys) {
  const populated = [];
  for (const key of keys) {
    if (route[key] === undefined || route[key] === null) continue;
    if (typeof route[key] !== 'string' || route[key].length === 0) {
      throw new ProviderResponseUnknownError();
    }
    populated.push(key);
  }
  return populated;
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {'local'|'default'|'other'} */
function routeKind(value, authority) {
  if (
    !isPlainObject(value) ||
    typeof value.Origin !== 'string' ||
    !ROUTE_ORIGINS.has(value.Origin) ||
    typeof value.State !== 'string' ||
    !ROUTE_STATES.has(value.State)
  ) {
    throw new ProviderResponseUnknownError();
  }
  const hasInstanceOwner =
    value.InstanceOwnerId !== undefined && value.InstanceOwnerId !== null;
  if (hasInstanceOwner) {
    if (
      typeof value.InstanceOwnerId !== 'string' ||
      value.InstanceOwnerId.length === 0
    ) {
      throw new ProviderResponseUnknownError();
    }
  }
  const destinations = populatedRouteFields(value, ROUTE_DESTINATION_KEYS);
  const targets = populatedRouteFields(value, ROUTE_TARGET_KEYS);
  if (destinations.length !== 1 || targets.length !== 1) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  const fixedIpv4GatewayShape =
    destinations[0] === 'DestinationCidrBlock' && targets[0] === 'GatewayId';
  if (
    fixedIpv4GatewayShape &&
    value.DestinationCidrBlock ===
      authority.providerSpec.capabilities.networking.vpcCidr
  ) {
    if (
      value.GatewayId !== 'local' ||
      value.Origin !== 'CreateRouteTable' ||
      value.State !== 'active' ||
      hasInstanceOwner
    ) {
      throw new SubnetRouteTableAssociationEvidenceConflictError();
    }
    return 'local';
  }
  if (
    fixedIpv4GatewayShape &&
    value.DestinationCidrBlock === authority.destinationCidrBlock
  ) {
    if (hasInstanceOwner) {
      throw new SubnetRouteTableAssociationEvidenceConflictError();
    }
    if (
      value.GatewayId !== authority.internetGatewayId ||
      value.Origin !== 'CreateRoute'
    ) {
      if (authority.action.action === 'delete') return 'other';
      throw new SubnetRouteTableAssociationEvidenceConflictError();
    }
    if (value.State !== 'active' && authority.action.action !== 'delete') {
      throw new SubnetRouteTableAssociationEvidenceTransientError();
    }
    return 'default';
  }
  if (value.GatewayId === 'local') {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  if (authority.action.action === 'delete') return 'other';
  throw new SubnetRouteTableAssociationEvidenceConflictError();
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {void} */
function validateRoutes(value, authority) {
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  let localRoutes = 0;
  let defaultRoutes = 0;
  for (const route of value) {
    const kind = routeKind(route, authority);
    if (kind === 'local') localRoutes += 1;
    if (kind === 'default') defaultRoutes += 1;
  }
  if (localRoutes !== 1 || defaultRoutes > 1) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  if (authority.action.action !== 'delete' && defaultRoutes !== 1) {
    throw new SubnetRouteTableAssociationEvidenceTransientError();
  }
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>|null} */
function intendedTableAssociation(value, authority) {
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  const matches = [];
  for (const candidate of value) {
    const association = decodeAssociation(candidate, authority.routeTableId);
    if (association.SubnetId === authority.subnetId) {
      matches.push(association);
    } else if (authority.action.action !== 'delete') {
      throw new SubnetRouteTableAssociationEvidenceConflictError();
    }
  }
  if (matches.length > 1) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  const match = matches[0] ?? null;
  if (match?.AssociationState.State === 'failed') {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  return match;
}

/** @param {unknown} value @param {boolean} deleting @returns {void} */
function validatePropagation(value, deleting) {
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  for (const propagation of value) {
    if (
      !isPlainObject(propagation) ||
      typeof propagation.GatewayId !== 'string' ||
      !/^vgw-[0-9a-f]{8,32}$/u.test(propagation.GatewayId)
    ) {
      throw new ProviderResponseUnknownError();
    }
  }
  if (!deleting && value.length > 0) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
}

/** @param {unknown} response @param {Readonly<Record<string, any>>} authority @returns {{routeTable: Readonly<Record<string, any>>, association: Readonly<Record<string, any>>|null}} */
function oneRouteTableFromResponse(response, authority) {
  if (!isPlainObject(response) || !Array.isArray(response.RouteTables)) {
    throw new ProviderResponseUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  if (response.RouteTables.length === 0) {
    throw new ProviderResponseUnknownError();
  }
  if (response.RouteTables.length !== 1) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  const routeTable = response.RouteTables[0];
  if (
    !isPlainObject(routeTable) ||
    typeof routeTable.RouteTableId !== 'string' ||
    !ROUTE_TABLE_ID_PATTERN.test(routeTable.RouteTableId) ||
    typeof routeTable.OwnerId !== 'string' ||
    typeof routeTable.VpcId !== 'string' ||
    !VPC_ID_PATTERN.test(routeTable.VpcId)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    routeTable.RouteTableId !== authority.routeTableId ||
    routeTable.OwnerId !== authority.plan.providerScope.accountId ||
    routeTable.VpcId !== authority.vpcId
  ) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  validateParentTags(
    routeTable.Tags,
    expectedParentTags(authority, 'route-table'),
  );
  validateRoutes(routeTable.Routes, authority);
  validatePropagation(
    routeTable.PropagatingVgws,
    authority.action.action === 'delete',
  );
  return {
    routeTable,
    association: intendedTableAssociation(routeTable.Associations, authority),
  };
}

/** @param {unknown} response @param {Readonly<Record<string, any>>} authority @returns {{associations: Readonly<Record<string, any>>[], nextToken: string|null}} */
function associationDiscoveryPage(response, authority) {
  if (!isPlainObject(response) || !Array.isArray(response.RouteTables)) {
    throw new ProviderResponseUnknownError();
  }
  let nextToken = null;
  if (response.NextToken !== undefined && response.NextToken !== null) {
    if (
      typeof response.NextToken !== 'string' ||
      response.NextToken.length === 0
    ) {
      throw new ProviderResponseUnknownError();
    }
    nextToken = response.NextToken;
  }
  const associations = [];
  for (const routeTable of response.RouteTables) {
    if (
      !isPlainObject(routeTable) ||
      typeof routeTable.RouteTableId !== 'string' ||
      !ROUTE_TABLE_ID_PATTERN.test(routeTable.RouteTableId) ||
      typeof routeTable.OwnerId !== 'string' ||
      typeof routeTable.VpcId !== 'string' ||
      !VPC_ID_PATTERN.test(routeTable.VpcId) ||
      !Array.isArray(routeTable.Associations)
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (
      routeTable.OwnerId !== authority.plan.providerScope.accountId ||
      routeTable.VpcId !== authority.vpcId
    ) {
      throw new SubnetRouteTableAssociationEvidenceConflictError();
    }
    let tableMatches = 0;
    for (const candidate of routeTable.Associations) {
      const association = decodeAssociation(candidate, routeTable.RouteTableId);
      if (association.SubnetId !== authority.subnetId) continue;
      tableMatches += 1;
      if (association.RouteTableId !== authority.routeTableId) {
        throw new SubnetRouteTableAssociationEvidenceConflictError();
      }
      if (association.AssociationState.State === 'failed') {
        throw new SubnetRouteTableAssociationEvidenceConflictError();
      }
      associations.push(association);
    }
    if (tableMatches === 0) throw new ProviderResponseUnknownError();
  }
  return { associations, nextToken };
}

/** @param {unknown[]} errors @returns {void} */
function throwStrongestEvidenceError(errors) {
  if (
    errors.some(
      (error) =>
        error instanceof SubnetRouteTableAssociationEvidenceConflictError,
    )
  ) {
    throw new SubnetRouteTableAssociationEvidenceConflictError();
  }
  if (errors.some((error) => error instanceof ProviderResponseUnknownError)) {
    throw new ProviderResponseUnknownError();
  }
  if (
    errors.some(
      (error) =>
        error instanceof SubnetRouteTableAssociationEvidenceTransientError,
    )
  ) {
    throw new SubnetRouteTableAssociationEvidenceTransientError();
  }
  if (errors.length > 0) throw new ProviderResponseUnknownError();
}

/**
 * Bind one exact dependency-derived explicit subnet association. The factory
 * never owns or closes the caller's narrow EC2 client.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>}
 */
export function createAwsSingleNodeSubnetRouteTableAssociationResource(
  options,
) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeSubnetRouteTableAssociation options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeSubnetRouteTableAssociation options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeSubnetRouteTableAssociation options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError(
      'awsSingleNodeSubnetRouteTableAssociation client must be an object.',
    );
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeSubnetRouteTableAssociation client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeSubnetRouteTableAssociation providerScope',
  );
  const maxAttempts =
    options.maxAttempts ??
    AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeSubnetRouteTableAssociation maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeSubnetRouteTableAssociation waitForRetry must be a function.',
    );
  }

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError();
    }
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeSubnetOnce(authority) {
    let response;
    try {
      response = await client.describeSubnets(
        deepFreeze({ SubnetIds: [authority.subnetId] }),
      );
    } catch (error) {
      if (subnetNotFound(error)) return null;
      throw new ProviderResponseUnknownError();
    }
    return oneSubnetFromResponse(response, authority);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<{routeTable: Readonly<Record<string, any>>, association: Readonly<Record<string, any>>|null}|null>} */
  async function describeRouteTableOnce(authority) {
    let response;
    try {
      response = await client.describeRouteTables(
        deepFreeze({ RouteTableIds: [authority.routeTableId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidRouteTableID.NotFound')) return null;
      throw new ProviderResponseUnknownError();
    }
    return oneRouteTableFromResponse(response, authority);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function discoverAssociationOnce(authority) {
    const associations = new Map();
    const seenTokens = new Set();
    let nextToken = null;
    for (
      let page = 1;
      page <=
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_DISCOVERY_PAGES;
      page += 1
    ) {
      let response;
      try {
        response = await client.describeRouteTables(
          deepFreeze({
            Filters: [
              {
                Name: 'association.subnet-id',
                Values: [authority.subnetId],
              },
            ],
            MaxResults:
              AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DISCOVERY_MAX_RESULTS,
            ...(nextToken === null ? {} : { NextToken: nextToken }),
          }),
        );
      } catch {
        throw new ProviderResponseUnknownError();
      }
      const observed = associationDiscoveryPage(response, authority);
      for (const association of observed.associations) {
        if (associations.has(association.RouteTableAssociationId)) {
          throw new SubnetRouteTableAssociationEvidenceConflictError();
        }
        associations.set(association.RouteTableAssociationId, association);
        if (
          association.RouteTableId !== authority.routeTableId ||
          associations.size > 1
        ) {
          throw new SubnetRouteTableAssociationEvidenceConflictError();
        }
      }
      if (observed.nextToken === null) break;
      if (
        page ===
          AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_DISCOVERY_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new ProviderResponseUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    return /** @type {Readonly<Record<string, any>>|null} */ (
      [...associations.values()][0] ?? null
    );
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<{state: 'present', association: Readonly<Record<string, any>>}|{state: 'absent'}>} */
  async function readLogicalState(authority) {
    const [subnetResult, routeTableResult, slotResult] =
      await Promise.allSettled([
        describeSubnetOnce(authority),
        describeRouteTableOnce(authority),
        discoverAssociationOnce(authority),
      ]);
    const errors = [];
    for (const result of [subnetResult, routeTableResult, slotResult]) {
      if (result.status === 'rejected') errors.push(result.reason);
    }
    throwStrongestEvidenceError(errors);
    if (
      subnetResult.status !== 'fulfilled' ||
      routeTableResult.status !== 'fulfilled' ||
      slotResult.status !== 'fulfilled'
    ) {
      throw new ProviderResponseUnknownError();
    }
    const subnet = subnetResult.value;
    const routeTable = routeTableResult.value;
    const exactAssociation = routeTable?.association ?? null;
    const slotAssociation = slotResult.value;
    if (
      authority.action.action !== 'delete' &&
      (subnet === null || routeTable === null)
    ) {
      throw new SubnetRouteTableAssociationEvidenceTransientError();
    }
    if (exactAssociation === null && slotAssociation === null) {
      return { state: 'absent' };
    }
    if (exactAssociation === null || slotAssociation === null) {
      throw new SubnetRouteTableAssociationEvidenceTransientError();
    }
    if (
      subnet === null ||
      routeTable === null ||
      exactAssociation.RouteTableAssociationId !==
        slotAssociation.RouteTableAssociationId ||
      exactAssociation.RouteTableId !== slotAssociation.RouteTableId ||
      exactAssociation.SubnetId !== slotAssociation.SubnetId ||
      exactAssociation.AssociationState.State !==
        slotAssociation.AssociationState.State
    ) {
      throw new SubnetRouteTableAssociationEvidenceTransientError();
    }
    if (exactAssociation.AssociationState.State !== 'associated') {
      throw new SubnetRouteTableAssociationEvidenceTransientError();
    }
    return { state: 'present', association: exactAssociation };
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    if (authority.action.action === 'noop') return;
    let logical;
    try {
      logical = await readLogicalState(authority);
    } catch (error) {
      if (error instanceof SubnetRouteTableAssociationEvidenceConflictError) {
        throw new AwsSingleNodeSubnetRouteTableAssociationResourceConflictError();
      }
      if (error instanceof SubnetRouteTableAssociationEvidenceTransientError) {
        return;
      }
      throw new AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError();
    }
    if (authority.action.action === 'delete') {
      if (logical.state === 'absent') return;
      try {
        await client.disassociateRouteTable(
          deepFreeze({
            AssociationId: logical.association.RouteTableAssociationId,
          }),
        );
      } catch (error) {
        if (
          errorNamed(error, 'InvalidAssociationID.NotFound') ||
          errorNamed(error, 'IncorrectState') ||
          errorNamed(error, 'DependencyViolation')
        ) {
          return;
        }
        throw new AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError();
      }
      return;
    }
    if (logical.state === 'present') return;
    try {
      await client.associateRouteTable(
        deepFreeze({
          RouteTableId: authority.routeTableId,
          SubnetId: authority.subnetId,
        }),
      );
    } catch (error) {
      if (
        errorNamed(error, 'Resource.AlreadyAssociated') ||
        errorNamed(error, 'InvalidRouteTableID.NotFound') ||
        subnetNotFound(error) ||
        errorNamed(error, 'IncorrectState')
      ) {
        return;
      }
      throw new AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError();
    }
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const logical = await readLogicalState(authority);
        if (
          logical.state === 'present' &&
          authority.action.action !== 'delete'
        ) {
          const binding =
            authority.priorBinding ??
            createDeploymentResourceBinding({
              schemaVersion: 2,
              kind: 'deploymentResourceBinding',
              deploymentInstanceId: authority.plan.deploymentInstanceId,
              incarnationId: authority.plan.incarnationId,
              resourceKey: authority.action.resourceKey,
              capability: authority.action.capability,
              role: authority.action.role,
              management: 'managed',
              ownershipMode: 'derived',
              onDestroy: 'purge',
              dependencyBindings: authority.dependencyBindings,
              providerType: PROVIDER_TYPE,
              providerResourceId: authority.providerResourceId,
              providerScopeId: providerScope.providerScopeId,
              ownershipNonce: authority.ownershipNonce,
              createdByActionId: authority.action.actionId,
            });
          return deepFreeze({ status: 'converged', binding });
        }
        if (
          logical.state === 'absent' &&
          authority.action.action === 'delete'
        ) {
          return deepFreeze({ status: 'converged', binding: null });
        }
      } catch (error) {
        if (error instanceof SubnetRouteTableAssociationEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof SubnetRouteTableAssociationEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError();
          }
          return Object.freeze({ status: 'not-converged' });
        }
        await wait(attempt);
        continue;
      }
      if (attempt < maxAttempts) await wait(attempt);
    }
    return authority.action.action === 'noop'
      ? Object.freeze({ status: 'blocked' })
      : Object.freeze({ status: 'not-converged' });
  }

  return Object.freeze({ executeAction, verifySettlement });
}

export default {
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_PREFIX,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_STATE_DIGEST_DOMAIN,
  AwsSingleNodeSubnetRouteTableAssociationResourceConflictError,
  AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError,
  createAwsSingleNodeSubnetRouteTableAssociationResource,
  getAwsSingleNodeSubnetRouteTableAssociationStateDigest,
};
