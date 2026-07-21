/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import { createCanonicalJsonSha256Id, sha256Base64Url } from './content-id.js';
import {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
  getAwsSingleNodeInternetGatewayAttachmentStateDigest,
} from './deployment-aws-internet-gateway-attachment-resource.js';
import {
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import { getAwsSingleNodeRouteTableStateDigest } from './deployment-aws-route-table-resource.js';
import {
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';

export const AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-default-ipv4-route-state:v1';
export const AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_DOMAIN =
  'wharfie:aws-single-node-ec2-default-ipv4-route:v1';
export const AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_PREFIX =
  'wir1';

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
  'createRoute',
  'describeInternetGateways',
  'describeRouteTables',
  'deleteRoute',
]);
const RESOURCE_KEY = 'network-default-ipv4-route';
const PROVIDER_TYPE = 'ec2-ipv4-route';
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const INTERNET_GATEWAY_ID_PATTERN = /^igw-[0-9a-f]{8,32}$/;
const ROUTE_TABLE_ID_PATTERN = /^rtb-[0-9a-f]{8,32}$/;
const ROUTE_TABLE_ASSOCIATION_ID_PATTERN = /^rtbassoc-[0-9a-f]{8,32}$/;
const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,32}$/;
const INTERNET_GATEWAY_ATTACHMENT_STATES = new Set([
  'available',
  'attaching',
  'attached',
  'detaching',
  'detached',
]);
const ROUTE_STATES = new Set(['active', 'blackhole']);
const ROUTE_ASSOCIATION_STATES = new Set([
  'associating',
  'associated',
  'disassociating',
  'disassociated',
  'failed',
]);
const ROUTE_ORIGINS = new Set([
  'Advertisement',
  'CreateRoute',
  'CreateRouteTable',
  'EnableVgwRoutePropagation',
]);
const ROUTE_TABLE_MAX_DISCOVERY_PAGES = 16;
const ROUTE_TABLE_DISCOVERY_MAX_RESULTS = 100;
const MAX_ROUTE_TABLE_TAGS = 50;
const ROUTE_TABLE_BASE_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-route-table',
  'wharfie:retention': 'purge',
  'wharfie:schema-version': '2',
});
const ROUTE_TABLE_LOCATOR_TAG_KEYS = Object.freeze([
  'wharfie:managed-by',
  'wharfie:resource-kind',
  'wharfie:capability',
  'wharfie:role',
  'wharfie:provider-scope-id',
  'wharfie:deployment-instance-id',
  'wharfie:incarnation-id',
  'wharfie:resource-key',
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
const DEPENDENCY_KEYS = Object.freeze([
  'network-internet-gateway-attachment',
  'network-route-table',
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
    resourceKey: 'network-route-table',
    providerType: 'ec2-route-table',
    role: Object.freeze({ kind: 'route-table', version: 1 }),
    ownershipMode: 'direct',
    dependsOn: Object.freeze(['network-vpc']),
    idPattern: ROUTE_TABLE_ID_PATTERN,
  }),
]);

/** Exact controller authority or present provider evidence is contradictory. */
export class AwsSingleNodeDefaultIpv4RouteResourceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node default IPv4 route conflicts with its exact contract.',
    );
    this.name = 'AwsSingleNodeDefaultIpv4RouteResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeDefaultIpv4RouteResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node default IPv4 route state is unknown.');
    this.name = 'AwsSingleNodeDefaultIpv4RouteResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_RESOURCE_UNKNOWN';
  }
}

class ProviderResponseUnknownError extends Error {}
class DefaultIpv4RouteEvidenceConflictError extends Error {}
class DefaultIpv4RouteEvidenceTransientError extends Error {}

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

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Derive the fixed logical route state. Provider-allocated endpoint IDs live
 * in binding lineage rather than this digest.
 * @param {unknown} value - Exact AWS single-node provider specification.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - State digest.
 */
export function getAwsSingleNodeDefaultIpv4RouteStateDigest(value) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeDefaultIpv4RouteState providerSpec',
  );
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2DefaultIpv4RouteState',
    destinationCidrBlock: providerSpec.capabilities.networking.egressCidr,
    targetKind: 'internet-gateway',
    origin: 'CreateRoute',
    state: 'active',
    onDestroy: 'purge',
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
function providerResourceId(
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
 * Resolve declared dependency receipts and their direct-resource lineage.
 * Apply dependencies are settled earlier; reverse-destroy dependencies are
 * pending later and therefore still required to exist.
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
      throw new AwsSingleNodeDefaultIpv4RouteResourceConflictError();
    }
    resolved.set(definition.resourceKey, binding);
    resolvedActions.set(definition.resourceKey, dependencyAction);
  }

  const vpcBinding = resolved.get('network-vpc');
  const internetGatewayBinding = resolved.get('network-internet-gateway');
  const attachmentBinding = resolved.get('network-internet-gateway-attachment');
  const routeTableBinding = resolved.get('network-route-table');
  const attachmentAction = resolvedActions.get(
    'network-internet-gateway-attachment',
  );
  const routeTableAction = resolvedActions.get('network-route-table');
  if (
    vpcBinding === undefined ||
    internetGatewayBinding === undefined ||
    attachmentBinding === undefined ||
    routeTableBinding === undefined ||
    attachmentAction === undefined ||
    routeTableAction === undefined
  ) {
    throw new AwsSingleNodeDefaultIpv4RouteResourceConflictError();
  }

  const attachmentDependencies = dependencyReceipts([
    vpcBinding,
    internetGatewayBinding,
  ]);
  const routeTableDependencies = dependencyReceipts([vpcBinding]);
  const expectedAttachmentProviderResourceId =
    internetGatewayAttachmentProviderResourceId(
      internetGatewayBinding.providerResourceId,
      vpcBinding.providerResourceId,
    );
  const expectedAttachmentStateDigest =
    getAwsSingleNodeInternetGatewayAttachmentStateDigest(providerSpec);
  const expectedRouteTableStateDigest =
    getAwsSingleNodeRouteTableStateDigest(providerSpec);
  const attachmentActionStateDigest =
    plan.operation === 'destroy'
      ? attachmentAction.before?.stateDigest
      : attachmentAction.after?.stateDigest;
  const routeTableActionStateDigest =
    plan.operation === 'destroy'
      ? routeTableAction.before?.stateDigest
      : routeTableAction.after?.stateDigest;
  if (
    attachmentBinding.providerResourceId !==
      expectedAttachmentProviderResourceId ||
    !sameDependencyBindings(
      attachmentBinding.dependencyBindings,
      attachmentDependencies,
    ) ||
    !sameDependencyBindings(
      routeTableBinding.dependencyBindings,
      routeTableDependencies,
    ) ||
    !sameJson(attachmentActionStateDigest, expectedAttachmentStateDigest) ||
    !sameJson(routeTableActionStateDigest, expectedRouteTableStateDigest)
  ) {
    throw new AwsSingleNodeDefaultIpv4RouteResourceConflictError();
  }

  const dependencyBindings = dependencyReceipts([
    attachmentBinding,
    routeTableBinding,
  ]);
  const destinationCidrBlock = providerSpec.capabilities.networking.egressCidr;
  const internetGatewayId = internetGatewayBinding.providerResourceId;
  const routeTableId = routeTableBinding.providerResourceId;
  const vpcId = vpcBinding.providerResourceId;
  return deepFreeze({
    vpcBinding,
    internetGatewayBinding,
    attachmentBinding,
    routeTableBinding,
    routeTableAction,
    routeTableStateDigest: expectedRouteTableStateDigest,
    dependencyBindings,
    destinationCidrBlock,
    internetGatewayId,
    routeTableId,
    vpcId,
    providerResourceId: providerResourceId(
      destinationCidrBlock,
      internetGatewayId,
      routeTableId,
    ),
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
      'awsSingleNodeDefaultIpv4Route action context must be an object.',
    );
  }
  assertExactKeys(
    value,
    ACTION_CONTEXT_KEYS,
    'awsSingleNodeDefaultIpv4Route context',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeDefaultIpv4Route context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeDefaultIpv4Route context.head',
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
    throw new AwsSingleNodeDefaultIpv4RouteResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeDefaultIpv4RouteResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.resourceKey !== RESOURCE_KEY ||
    !sameJson(action.capability, { kind: 'networking', version: 1 }) ||
    !sameJson(action.role, { kind: 'default-ipv4-route', version: 1 }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'derived' ||
    action.onDestroy !== 'purge' ||
    !sameJson(action.dependsOn, DEPENDENCY_KEYS)
  ) {
    throw new AwsSingleNodeDefaultIpv4RouteResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeDefaultIpv4Route context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeDefaultIpv4RouteResourceConflictError();
  }
  const dependencies = resolveDependencyAuthority(
    plan,
    head,
    value.actionIndex,
    providerScope,
    canonicalProviderSpec,
  );
  const stateDigest = getAwsSingleNodeDefaultIpv4RouteStateDigest(
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
      throw new AwsSingleNodeDefaultIpv4RouteResourceConflictError();
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
      throw new AwsSingleNodeDefaultIpv4RouteResourceConflictError();
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
      throw new AwsSingleNodeDefaultIpv4RouteResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeDefaultIpv4RouteResourceConflictError();
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

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, string>>} */
function expectedRouteTableTags(authority) {
  return deepFreeze({
    ...ROUTE_TABLE_BASE_TAGS,
    'wharfie:capability': 'networking',
    'wharfie:role': 'route-table',
    'wharfie:provider-scope-id': authority.plan.providerScope.providerScopeId,
    'wharfie:deployment-instance-id': authority.plan.deploymentInstanceId,
    'wharfie:incarnation-id': authority.plan.incarnationId,
    'wharfie:resource-key': 'network-route-table',
    'wharfie:created-by-action-id':
      authority.routeTableBinding.createdByActionId,
    'wharfie:ownership-nonce': authority.routeTableBinding.ownershipNonce,
    'wharfie:state-digest': authority.routeTableStateDigest.value,
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {void} */
function validateRouteTableTags(value, authority) {
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  if (value.length > MAX_ROUTE_TABLE_TAGS) {
    throw new DefaultIpv4RouteEvidenceConflictError();
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
      throw new DefaultIpv4RouteEvidenceConflictError();
    }
    observed.set(tag.Key, tag.Value);
  }
  const expected = expectedRouteTableTags(authority);
  for (const [key, value] of observed) {
    const reserved = Object.hasOwn(expected, key);
    if (key.startsWith('wharfie:') && !reserved) {
      throw new DefaultIpv4RouteEvidenceConflictError();
    }
    if (reserved && expected[key] !== value) {
      throw new DefaultIpv4RouteEvidenceConflictError();
    }
  }
  if (
    !Object.entries(expected).every(
      ([key, value]) => observed.get(key) === value,
    )
  ) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Array<Readonly<{Name: string, Values: readonly string[]}>>>} */
function routeTableDiscoveryFilters(authority) {
  const tags = expectedRouteTableTags(authority);
  return deepFreeze(
    ROUTE_TABLE_LOCATOR_TAG_KEYS.map((key) => ({
      Name: `tag:${key}`,
      Values: [tags[key]],
    })),
  );
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {void} */
function validateRouteTableAssociations(value, authority) {
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  for (const association of value) {
    if (!isPlainObject(association) || typeof association.Main !== 'boolean') {
      throw new ProviderResponseUnknownError();
    }
    if (
      typeof association.RouteTableAssociationId !== 'string' ||
      !ROUTE_TABLE_ASSOCIATION_ID_PATTERN.test(
        association.RouteTableAssociationId,
      ) ||
      typeof association.RouteTableId !== 'string' ||
      !ROUTE_TABLE_ID_PATTERN.test(association.RouteTableId) ||
      !isPlainObject(association.AssociationState) ||
      typeof association.AssociationState.State !== 'string'
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (
      association.AssociationState.StatusMessage !== undefined &&
      association.AssociationState.StatusMessage !== null &&
      typeof association.AssociationState.StatusMessage !== 'string'
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (
      association.RouteTableId !== authority.routeTableId ||
      association.Main
    ) {
      throw new DefaultIpv4RouteEvidenceConflictError();
    }
    if (!ROUTE_ASSOCIATION_STATES.has(association.AssociationState.State)) {
      throw new ProviderResponseUnknownError();
    }
    const subnetPresent =
      association.SubnetId !== undefined && association.SubnetId !== null;
    const gatewayPresent =
      association.GatewayId !== undefined && association.GatewayId !== null;
    if (
      (subnetPresent &&
        (typeof association.SubnetId !== 'string' ||
          !SUBNET_ID_PATTERN.test(association.SubnetId))) ||
      (gatewayPresent &&
        (typeof association.GatewayId !== 'string' ||
          !/^(?:igw|vgw)-[0-9a-f]{8,32}$/u.test(association.GatewayId)))
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (
      Number(subnetPresent) + Number(gatewayPresent) !== 1 ||
      !subnetPresent ||
      (association.PublicIpv4Pool !== undefined &&
        association.PublicIpv4Pool !== null)
    ) {
      throw new DefaultIpv4RouteEvidenceConflictError();
    }
  }
  if (value.length > 1) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  if (value.length === 1) {
    if (authority.action.action === 'delete') {
      throw new DefaultIpv4RouteEvidenceTransientError();
    }
    if (authority.action.action !== 'noop') {
      throw new DefaultIpv4RouteEvidenceConflictError();
    }
  }
}

/** @param {unknown} value @returns {void} */
function validateRouteTablePropagation(value) {
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
  if (value.length > 0) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
}

/** @param {unknown} response @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function oneInternetGatewayFromResponse(response, authority) {
  if (!isPlainObject(response) || !Array.isArray(response.InternetGateways)) {
    throw new ProviderResponseUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  if (response.InternetGateways.length === 0) {
    throw new ProviderResponseUnknownError();
  }
  if (response.InternetGateways.length !== 1) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  const internetGateway = response.InternetGateways[0];
  if (
    !isPlainObject(internetGateway) ||
    typeof internetGateway.InternetGatewayId !== 'string' ||
    !INTERNET_GATEWAY_ID_PATTERN.test(internetGateway.InternetGatewayId) ||
    typeof internetGateway.OwnerId !== 'string' ||
    !Array.isArray(internetGateway.Attachments)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    internetGateway.InternetGatewayId !== authority.internetGatewayId ||
    internetGateway.OwnerId !== authority.plan.providerScope.accountId ||
    internetGateway.Attachments.length > 1
  ) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  if (internetGateway.Attachments.length === 0) {
    throw new DefaultIpv4RouteEvidenceTransientError();
  }
  const attachment = internetGateway.Attachments[0];
  if (
    !isPlainObject(attachment) ||
    typeof attachment.VpcId !== 'string' ||
    !VPC_ID_PATTERN.test(attachment.VpcId) ||
    typeof attachment.State !== 'string' ||
    !INTERNET_GATEWAY_ATTACHMENT_STATES.has(attachment.State)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (attachment.VpcId !== authority.vpcId) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  if (attachment.State !== 'available') {
    throw new DefaultIpv4RouteEvidenceTransientError();
  }
  return internetGateway;
}

/** @param {unknown} response @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function oneRouteTableFromResponse(response, authority) {
  if (!isPlainObject(response) || !Array.isArray(response.RouteTables)) {
    throw new ProviderResponseUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  if (response.RouteTables.length === 0) {
    throw new ProviderResponseUnknownError();
  }
  if (response.RouteTables.length !== 1) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  const routeTable = response.RouteTables[0];
  if (
    !isPlainObject(routeTable) ||
    typeof routeTable.RouteTableId !== 'string' ||
    !ROUTE_TABLE_ID_PATTERN.test(routeTable.RouteTableId) ||
    typeof routeTable.OwnerId !== 'string' ||
    typeof routeTable.VpcId !== 'string' ||
    !VPC_ID_PATTERN.test(routeTable.VpcId) ||
    !Array.isArray(routeTable.Routes)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    routeTable.RouteTableId !== authority.routeTableId ||
    routeTable.OwnerId !== authority.plan.providerScope.accountId ||
    routeTable.VpcId !== authority.vpcId
  ) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  validateRouteTableTags(routeTable.Tags, authority);
  validateRouteTableAssociations(routeTable.Associations, authority);
  validateRouteTablePropagation(routeTable.PropagatingVgws);
  return routeTable;
}

/** @param {unknown} response @param {Readonly<Record<string, any>>} authority @returns {{routeTables: Readonly<Record<string, any>>[], nextToken: string|null}} */
function routeTableDiscoveryPage(response, authority) {
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
  const routeTables = [];
  for (const routeTable of response.RouteTables) {
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
      routeTable.OwnerId !== authority.plan.providerScope.accountId ||
      routeTable.VpcId !== authority.vpcId
    ) {
      throw new DefaultIpv4RouteEvidenceConflictError();
    }
    validateRouteTableTags(routeTable.Tags, authority);
    routeTables.push(routeTable);
  }
  return { routeTables, nextToken };
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

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {'local'|'default'} */
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
  if (value.InstanceOwnerId !== undefined && value.InstanceOwnerId !== null) {
    if (
      typeof value.InstanceOwnerId !== 'string' ||
      value.InstanceOwnerId.length === 0
    ) {
      throw new ProviderResponseUnknownError();
    }
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  const destinations = populatedRouteFields(value, ROUTE_DESTINATION_KEYS);
  const targets = populatedRouteFields(value, ROUTE_TARGET_KEYS);
  if (destinations.length !== 1 || targets.length !== 1) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  if (
    destinations[0] !== 'DestinationCidrBlock' ||
    targets[0] !== 'GatewayId'
  ) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  if (
    value.DestinationCidrBlock ===
    authority.providerSpec.capabilities.networking.vpcCidr
  ) {
    if (
      value.GatewayId !== 'local' ||
      value.Origin !== 'CreateRouteTable' ||
      value.State !== 'active'
    ) {
      throw new DefaultIpv4RouteEvidenceConflictError();
    }
    return 'local';
  }
  if (value.DestinationCidrBlock !== authority.destinationCidrBlock) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  if (
    value.GatewayId !== authority.internetGatewayId ||
    value.Origin !== 'CreateRoute'
  ) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  if (value.State !== 'active' && authority.action.action !== 'delete') {
    throw new DefaultIpv4RouteEvidenceTransientError();
  }
  return 'default';
}

/** @param {Readonly<Record<string, any>>} routeTable @param {Readonly<Record<string, any>>} authority @returns {'present'|'absent'} */
function logicalRouteState(routeTable, authority) {
  let localRoutes = 0;
  let defaultRoutes = 0;
  for (const route of routeTable.Routes) {
    const kind = routeKind(route, authority);
    if (kind === 'local') localRoutes += 1;
    else defaultRoutes += 1;
  }
  if (localRoutes !== 1 || defaultRoutes > 1) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  return defaultRoutes === 1 ? 'present' : 'absent';
}

/** @param {unknown[]} errors @returns {void} */
function throwStrongestEvidenceError(errors) {
  if (
    errors.some(
      (error) => error instanceof DefaultIpv4RouteEvidenceConflictError,
    )
  ) {
    throw new DefaultIpv4RouteEvidenceConflictError();
  }
  if (errors.some((error) => error instanceof ProviderResponseUnknownError)) {
    throw new ProviderResponseUnknownError();
  }
  if (
    errors.some(
      (error) => error instanceof DefaultIpv4RouteEvidenceTransientError,
    )
  ) {
    throw new DefaultIpv4RouteEvidenceTransientError();
  }
  if (errors.length > 0) throw new ProviderResponseUnknownError();
}

/**
 * Bind one exact dependency-derived default IPv4 route. The factory never
 * owns or closes the caller's narrow EC2 client.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>}
 */
export function createAwsSingleNodeDefaultIpv4RouteResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeDefaultIpv4Route options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeDefaultIpv4Route options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeDefaultIpv4Route options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError(
      'awsSingleNodeDefaultIpv4Route client must be an object.',
    );
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeDefaultIpv4Route client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeDefaultIpv4Route providerScope',
  );
  const maxAttempts =
    options.maxAttempts ??
    AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeDefaultIpv4Route maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeDefaultIpv4Route waitForRetry must be a function.',
    );
  }

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeDefaultIpv4RouteResourceUnknownError();
    }
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>>} */
  async function describeInternetGatewayOnce(authority) {
    let response;
    try {
      response = await client.describeInternetGateways(
        deepFreeze({
          InternetGatewayIds: [authority.internetGatewayId],
        }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidInternetGatewayID.NotFound')) {
        throw new DefaultIpv4RouteEvidenceTransientError();
      }
      throw new ProviderResponseUnknownError();
    }
    return oneInternetGatewayFromResponse(response, authority);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeRouteTableOnce(authority) {
    let response;
    try {
      response = await client.describeRouteTables(
        deepFreeze({ RouteTableIds: [authority.routeTableId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidRouteTableID.NotFound')) {
        return null;
      }
      throw new ProviderResponseUnknownError();
    }
    return oneRouteTableFromResponse(response, authority);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Map<string, Readonly<Record<string, any>>>>} */
  async function discoverRouteTableOnce(authority) {
    const matches = new Map();
    const seenTokens = new Set();
    const filters = routeTableDiscoveryFilters(authority);
    let nextToken = null;
    for (let page = 1; page <= ROUTE_TABLE_MAX_DISCOVERY_PAGES; page += 1) {
      let response;
      try {
        response = await client.describeRouteTables(
          deepFreeze({
            Filters: filters,
            MaxResults: ROUTE_TABLE_DISCOVERY_MAX_RESULTS,
            ...(nextToken === null ? {} : { NextToken: nextToken }),
          }),
        );
      } catch {
        throw new ProviderResponseUnknownError();
      }
      const observed = routeTableDiscoveryPage(response, authority);
      for (const routeTable of observed.routeTables) {
        if (matches.has(routeTable.RouteTableId)) {
          throw new DefaultIpv4RouteEvidenceConflictError();
        }
        matches.set(routeTable.RouteTableId, routeTable);
      }
      if (observed.nextToken === null) return matches;
      if (
        page === ROUTE_TABLE_MAX_DISCOVERY_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new ProviderResponseUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    throw new ProviderResponseUnknownError();
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<'present'|'absent'>} */
  async function readLogicalState(authority) {
    const reads = [describeRouteTableOnce(authority)];
    if (authority.action.action !== 'delete') {
      reads.push(describeInternetGatewayOnce(authority));
    }
    const [routeTableResult, internetGatewayResult] =
      await Promise.allSettled(reads);
    const errors = [];
    if (routeTableResult.status === 'rejected') {
      errors.push(routeTableResult.reason);
    }
    if (internetGatewayResult?.status === 'rejected') {
      errors.push(internetGatewayResult.reason);
    }
    throwStrongestEvidenceError(errors);
    if (routeTableResult.status !== 'fulfilled') {
      throw new ProviderResponseUnknownError();
    }
    if (routeTableResult.value === null) {
      if (authority.action.action !== 'delete') {
        throw new DefaultIpv4RouteEvidenceTransientError();
      }
      const discovered = await discoverRouteTableOnce(authority);
      if (discovered.size === 0) return 'absent';
      if (discovered.size === 1 && discovered.has(authority.routeTableId)) {
        throw new DefaultIpv4RouteEvidenceTransientError();
      }
      throw new DefaultIpv4RouteEvidenceConflictError();
    }
    if (
      authority.action.action !== 'delete' &&
      internetGatewayResult?.status !== 'fulfilled'
    ) {
      throw new ProviderResponseUnknownError();
    }
    return logicalRouteState(routeTableResult.value, authority);
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    if (authority.action.action === 'noop') return;
    let state;
    try {
      state = await readLogicalState(authority);
    } catch (error) {
      if (error instanceof DefaultIpv4RouteEvidenceConflictError) {
        throw new AwsSingleNodeDefaultIpv4RouteResourceConflictError();
      }
      if (error instanceof DefaultIpv4RouteEvidenceTransientError) return;
      throw new AwsSingleNodeDefaultIpv4RouteResourceUnknownError();
    }
    if (authority.action.action === 'delete') {
      if (state === 'absent') return;
      try {
        await client.deleteRoute(
          deepFreeze({
            RouteTableId: authority.routeTableId,
            DestinationCidrBlock: authority.destinationCidrBlock,
          }),
        );
      } catch (error) {
        if (
          errorNamed(error, 'InvalidRoute.NotFound') ||
          errorNamed(error, 'InvalidRouteTableID.NotFound') ||
          errorNamed(error, 'IncorrectState') ||
          errorNamed(error, 'DependencyViolation')
        ) {
          return;
        }
        throw new AwsSingleNodeDefaultIpv4RouteResourceUnknownError();
      }
      return;
    }
    if (state === 'present') return;
    try {
      await client.createRoute(
        deepFreeze({
          RouteTableId: authority.routeTableId,
          DestinationCidrBlock: authority.destinationCidrBlock,
          GatewayId: authority.internetGatewayId,
        }),
      );
    } catch (error) {
      if (
        errorNamed(error, 'RouteAlreadyExists') ||
        errorNamed(error, 'InvalidGatewayID.NotFound') ||
        errorNamed(error, 'InvalidRouteTableID.NotFound') ||
        errorNamed(error, 'IncorrectState') ||
        errorNamed(error, 'DependencyViolation')
      ) {
        return;
      }
      throw new AwsSingleNodeDefaultIpv4RouteResourceUnknownError();
    }
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const state = await readLogicalState(authority);
        if (state === 'present' && authority.action.action !== 'delete') {
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
        if (state === 'absent' && authority.action.action === 'delete') {
          return deepFreeze({ status: 'converged', binding: null });
        }
      } catch (error) {
        if (error instanceof DefaultIpv4RouteEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof DefaultIpv4RouteEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeDefaultIpv4RouteResourceUnknownError();
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
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_PREFIX,
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_STATE_DIGEST_DOMAIN,
  AwsSingleNodeDefaultIpv4RouteResourceConflictError,
  AwsSingleNodeDefaultIpv4RouteResourceUnknownError,
  createAwsSingleNodeDefaultIpv4RouteResource,
  getAwsSingleNodeDefaultIpv4RouteStateDigest,
};
