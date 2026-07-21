/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  sha256Base64Url,
} from './content-id.js';
import {
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  DEPLOYMENT_ACTION_ID_PREFIX,
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import {
  AwsTaggedEc2RecoveryConflictError as RouteTableEvidenceConflictError,
  AwsTaggedEc2RecoveryTransientError as RouteTableEvidenceTransientError,
  AwsTaggedEc2RecoveryUnknownError as ProviderResponseUnknownError,
  createAwsTaggedEc2RecoveryKernel,
} from './deployment-aws-tagged-ec2-recovery.js';

export const AWS_SINGLE_NODE_ROUTE_TABLE_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_ROUTE_TABLE_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_ROUTE_TABLE_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_ROUTE_TABLE_DISCOVERY_MAX_RESULTS = 100;
export const AWS_SINGLE_NODE_ROUTE_TABLE_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-route-table-state:v1';
export const AWS_SINGLE_NODE_ROUTE_TABLE_CREATE_CLIENT_TOKEN_DOMAIN =
  'wharfie:aws-single-node-ec2-route-table-create-client-token:v1';

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
  'createRouteTable',
  'describeRouteTables',
  'deleteRouteTable',
]);
const RESOURCE_KEY = 'network-route-table';
const PROVIDER_TYPE = 'ec2-route-table';
const ROUTE_TABLE_ID_PATTERN = /^rtb-[0-9a-f]{8,32}$/;
const ROUTE_TABLE_ASSOCIATION_ID_PATTERN = /^rtbassoc-[0-9a-f]{8,32}$/;
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,32}$/;
const INTERNET_GATEWAY_ID_PATTERN = /^igw-[0-9a-f]{8,32}$/;
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
const MAX_ROUTE_TABLE_TAGS = 50;

const BASE_RESERVED_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-route-table',
  'wharfie:retention': 'purge',
  'wharfie:schema-version': '2',
});

const VPC_DEPENDENCY = Object.freeze({
  resourceKey: 'network-vpc',
  providerType: 'ec2-vpc',
  role: Object.freeze({ kind: 'vpc', version: 1 }),
});

/** Exact controller authority or present provider evidence is contradictory. */
export class AwsSingleNodeRouteTableResourceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node route table resource conflicts with its exact contract.',
    );
    this.name = 'AwsSingleNodeRouteTableResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_ROUTE_TABLE_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeRouteTableResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node route table resource state is unknown.');
    this.name = 'AwsSingleNodeRouteTableResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_ROUTE_TABLE_RESOURCE_UNKNOWN';
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
function routeTableNotFound(error) {
  return errorNamed(error, 'InvalidRouteTableID.NotFound');
}

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Derive the exact intrinsic route-table state. The dynamically allocated
 * parent VPC identity belongs to dependency lineage rather than this digest.
 * @param {unknown} value - Exact AWS single-node provider specification.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - State digest.
 */
export function getAwsSingleNodeRouteTableStateDigest(value) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeRouteTableState providerSpec',
  );
  const vpcCidrBlock = providerSpec.capabilities.networking.vpcCidr;
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2RouteTableState',
    localIpv4Route: {
      destinationCidrBlock: vpcCidrBlock,
      gatewayId: 'local',
      origin: 'CreateRouteTable',
      state: 'active',
    },
    main: false,
    propagatingVirtualGateways: [],
    onDestroy: 'purge',
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_ROUTE_TABLE_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/**
 * Give each durable create intent one replay-stable EC2 idempotency token.
 * @param {unknown} actionId - Exact deployment action identity.
 * @param {unknown} ownershipNonce - Exact durable effect nonce.
 * @returns {string} - Domain-separated lowercase SHA-256 token.
 */
export function getAwsSingleNodeRouteTableCreateClientToken(
  actionId,
  ownershipNonce,
) {
  assertDomainSeparatedSha256Id(
    actionId,
    DEPLOYMENT_ACTION_ID_PREFIX,
    'awsSingleNodeRouteTable clientToken actionId',
  );
  const canonicalOwnershipNonce = validateOwnershipNonce(
    ownershipNonce,
    'awsSingleNodeRouteTable clientToken ownershipNonce',
  );
  const payload = JSON.stringify(
    sortCanonicalJsonValue({
      actionId,
      ownershipNonce: canonicalOwnershipNonce,
    }),
  );
  return Buffer.from(
    sha256Base64Url(
      `${AWS_SINGLE_NODE_ROUTE_TABLE_CREATE_CLIENT_TOKEN_DOMAIN}\0${payload}`,
    ),
    'base64url',
  ).toString('hex');
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {Readonly<import('@aws-sdk/client-ec2').CreateRouteTableCommandInput>} */
function createRouteTableRequest(authority, recovery) {
  return deepFreeze({
    ClientToken: getAwsSingleNodeRouteTableCreateClientToken(
      authority.action.actionId,
      authority.ownershipNonce,
    ),
    VpcId: authority.vpcId,
    TagSpecifications: [
      {
        ResourceType: 'route-table',
        Tags: recovery.sortedTags(recovery.requiredTags(authority)),
      },
    ],
  });
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} providerScope @returns {boolean} */
function vpcDependencyBindingMatches(binding, plan, providerScope) {
  return (
    binding.management === 'managed' &&
    binding.providerType === VPC_DEPENDENCY.providerType &&
    VPC_ID_PATTERN.test(binding.providerResourceId) &&
    binding.deploymentInstanceId === plan.deploymentInstanceId &&
    binding.resourceKey === VPC_DEPENDENCY.resourceKey &&
    binding.providerScopeId === providerScope.providerScopeId &&
    binding.incarnationId === plan.incarnationId &&
    sameJson(binding.capability, { kind: 'networking', version: 1 }) &&
    sameJson(binding.role, VPC_DEPENDENCY.role) &&
    binding.ownershipMode === 'direct' &&
    binding.onDestroy === 'purge' &&
    binding.dependencyBindings.length === 0
  );
}

/**
 * Resolve the exact VPC receipt. Apply/reconcile depend on an earlier settled
 * action; reverse destroy depends on the later pending, still-intact VPC.
 * @param {Readonly<Record<string, any>>} plan - Exact immutable action plan.
 * @param {Readonly<Record<string, any>>} head - Current durable authority.
 * @param {number} actionIndex - Current intended action index.
 * @param {Readonly<Record<string, any>>} providerScope - Fixed AWS scope.
 * @returns {Readonly<{vpcBinding: Readonly<Record<string, any>>, vpcId: string, dependencyBindings: Readonly<Array<{resourceKey: string, bindingId: string}>>}>}
 */
function resolveVpcDependencyAuthority(plan, head, actionIndex, providerScope) {
  const dependencyActionIndex = plan.actions.findIndex(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === VPC_DEPENDENCY.resourceKey,
  );
  const dependencyAction = plan.actions[dependencyActionIndex];
  const dependencyIntent = head.activeOperation.intents[dependencyActionIndex];
  const vpcBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === VPC_DEPENDENCY.resourceKey,
  );
  const applyAuthority =
    plan.operation !== 'destroy' &&
    dependencyActionIndex >= 0 &&
    dependencyActionIndex < actionIndex &&
    dependencyIntent?.status === 'settled' &&
    dependencyAction?.after !== null &&
    dependencyAction?.after !== undefined &&
    dependencyAction.after.providerType === VPC_DEPENDENCY.providerType &&
    (dependencyAction.after.providerResourceId === null ||
      dependencyAction.after.providerResourceId ===
        vpcBinding?.providerResourceId);
  const destroyAuthority =
    plan.operation === 'destroy' &&
    dependencyActionIndex > actionIndex &&
    dependencyIntent?.status === 'pending' &&
    dependencyAction?.action === 'delete' &&
    dependencyAction.before !== null &&
    dependencyAction.before.providerType === VPC_DEPENDENCY.providerType &&
    dependencyAction.before.providerResourceId ===
      vpcBinding?.providerResourceId;
  if (
    vpcBinding === undefined ||
    dependencyAction === undefined ||
    dependencyIntent === undefined ||
    (!applyAuthority && !destroyAuthority) ||
    dependencyIntent.actionId !== dependencyAction.actionId ||
    dependencyIntent.ownershipNonce !== vpcBinding.ownershipNonce ||
    dependencyAction.resourceKey !== VPC_DEPENDENCY.resourceKey ||
    !sameJson(dependencyAction.capability, {
      kind: 'networking',
      version: 1,
    }) ||
    !sameJson(dependencyAction.role, VPC_DEPENDENCY.role) ||
    dependencyAction.management !== 'managed' ||
    dependencyAction.ownershipMode !== 'direct' ||
    dependencyAction.onDestroy !== 'purge' ||
    dependencyAction.dependsOn.length !== 0 ||
    !vpcDependencyBindingMatches(vpcBinding, plan, providerScope) ||
    (dependencyAction.action === 'create' &&
      vpcBinding.createdByActionId !== dependencyAction.actionId)
  ) {
    throw new AwsSingleNodeRouteTableResourceConflictError();
  }
  return deepFreeze({
    vpcBinding,
    vpcId: vpcBinding.providerResourceId,
    dependencyBindings: [
      {
        resourceKey: vpcBinding.resourceKey,
        bindingId: vpcBinding.bindingId,
      },
    ],
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
    ROUTE_TABLE_ID_PATTERN.test(binding.providerResourceId) &&
    binding.deploymentInstanceId === plan.deploymentInstanceId &&
    binding.resourceKey === RESOURCE_KEY &&
    binding.providerScopeId === providerScope.providerScopeId &&
    binding.incarnationId === plan.incarnationId &&
    sameJson(binding.capability, action.capability) &&
    sameJson(binding.role, action.role) &&
    binding.ownershipMode === 'direct' &&
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
      'awsSingleNodeRouteTable action context must be an object.',
    );
  }
  assertExactKeys(
    value,
    ACTION_CONTEXT_KEYS,
    'awsSingleNodeRouteTable context',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeRouteTable context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeRouteTable context.head',
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
    throw new AwsSingleNodeRouteTableResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeRouteTableResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.resourceKey !== RESOURCE_KEY ||
    !sameJson(action.capability, { kind: 'networking', version: 1 }) ||
    !sameJson(action.role, { kind: 'route-table', version: 1 }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'purge' ||
    !sameJson(action.dependsOn, [VPC_DEPENDENCY.resourceKey])
  ) {
    throw new AwsSingleNodeRouteTableResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeRouteTable context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeRouteTableResourceConflictError();
  }
  const dependencies = resolveVpcDependencyAuthority(
    plan,
    head,
    value.actionIndex,
    providerScope,
  );
  const stateDigest = getAwsSingleNodeRouteTableStateDigest(
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
      throw new AwsSingleNodeRouteTableResourceConflictError();
    }
  } else if (action.action === 'noop') {
    if (
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
      throw new AwsSingleNodeRouteTableResourceConflictError();
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
      throw new AwsSingleNodeRouteTableResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeRouteTableResourceConflictError();
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

/** @param {unknown} value @param {string} expectedClientToken @returns {string} */
function candidateRouteTableId(value, expectedClientToken) {
  if (!isPlainObject(value) || typeof value.ClientToken !== 'string') {
    throw new ProviderResponseUnknownError();
  }
  if (value.ClientToken !== expectedClientToken) {
    throw new RouteTableEvidenceConflictError();
  }
  if (
    !isPlainObject(value.RouteTable) ||
    typeof value.RouteTable.RouteTableId !== 'string' ||
    !ROUTE_TABLE_ID_PATTERN.test(value.RouteTable.RouteTableId)
  ) {
    throw new ProviderResponseUnknownError();
  }
  return value.RouteTable.RouteTableId;
}

/** @param {unknown} response @param {string} exactRouteTableId @returns {Readonly<Record<string, any>>} */
function oneRouteTableFromResponse(response, exactRouteTableId) {
  if (!isPlainObject(response) || !Array.isArray(response.RouteTables)) {
    throw new ProviderResponseUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new RouteTableEvidenceConflictError();
  }
  if (response.RouteTables.length === 0) {
    throw new ProviderResponseUnknownError();
  }
  if (response.RouteTables.length !== 1) {
    throw new RouteTableEvidenceConflictError();
  }
  const routeTable = response.RouteTables[0];
  if (
    !isPlainObject(routeTable) ||
    typeof routeTable.RouteTableId !== 'string' ||
    !ROUTE_TABLE_ID_PATTERN.test(routeTable.RouteTableId)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (routeTable.RouteTableId !== exactRouteTableId) {
    throw new RouteTableEvidenceConflictError();
  }
  return routeTable;
}

/** @param {unknown} response @returns {{routeTables: Readonly<Record<string, any>>[], nextToken: string|null}} */
function discoveryPage(response) {
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
      !ROUTE_TABLE_ID_PATTERN.test(routeTable.RouteTableId)
    ) {
      throw new ProviderResponseUnknownError();
    }
    routeTables.push(routeTable);
  }
  return { routeTables, nextToken };
}

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

/** @param {Readonly<Record<string, any>>} route @param {boolean} allowOther @returns {'local'|'default'|'other'} */
function routeKind(route, allowOther) {
  if (
    !isPlainObject(route) ||
    typeof route.Origin !== 'string' ||
    typeof route.State !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (!ROUTE_STATES.has(route.State)) {
    throw new ProviderResponseUnknownError();
  }
  if (!ROUTE_ORIGINS.has(route.Origin)) {
    throw new ProviderResponseUnknownError();
  }
  let hasInstanceOwner = false;
  if (route.InstanceOwnerId !== undefined && route.InstanceOwnerId !== null) {
    if (
      typeof route.InstanceOwnerId !== 'string' ||
      route.InstanceOwnerId.length === 0
    ) {
      throw new ProviderResponseUnknownError();
    }
    hasInstanceOwner = true;
  }
  const destinations = populatedRouteFields(route, ROUTE_DESTINATION_KEYS);
  const targets = populatedRouteFields(route, ROUTE_TARGET_KEYS);
  if (destinations.length !== 1 || targets.length !== 1) {
    throw new RouteTableEvidenceConflictError();
  }
  const fixedIpv4GatewayShape =
    destinations[0] === 'DestinationCidrBlock' &&
    targets.length === 1 &&
    targets[0] === 'GatewayId';
  if (
    fixedIpv4GatewayShape &&
    route.GatewayId === 'local' &&
    route.Origin === 'CreateRouteTable' &&
    route.State === 'active' &&
    targets.length === 1 &&
    !hasInstanceOwner
  ) {
    return 'local';
  }
  if (
    fixedIpv4GatewayShape &&
    route.DestinationCidrBlock === '0.0.0.0/0' &&
    INTERNET_GATEWAY_ID_PATTERN.test(route.GatewayId) &&
    route.Origin === 'CreateRoute' &&
    targets.length === 1 &&
    !hasInstanceOwner
  ) {
    return 'default';
  }
  if (route.GatewayId === 'local') {
    throw new RouteTableEvidenceConflictError();
  }
  if (allowOther) return 'other';
  throw new RouteTableEvidenceConflictError();
}

/** @param {unknown} value @param {string} routeTableId @param {boolean} deleting @returns {number} */
function validateAssociations(value, routeTableId, deleting) {
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  if (!deleting && value.length > 1) {
    throw new RouteTableEvidenceConflictError();
  }
  for (const association of value) {
    if (!isPlainObject(association) || typeof association.Main !== 'boolean') {
      throw new ProviderResponseUnknownError();
    }
    if (association.Main) throw new RouteTableEvidenceConflictError();
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
    if (association.RouteTableId !== routeTableId) {
      throw new RouteTableEvidenceConflictError();
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
      (!deleting && !subnetPresent) ||
      (association.PublicIpv4Pool !== undefined &&
        association.PublicIpv4Pool !== null)
    ) {
      throw new RouteTableEvidenceConflictError();
    }
  }
  return value.length;
}

/** @param {unknown} value @returns {number} */
function validatePropagation(value) {
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
  return value.length;
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {{hasNonlocalRoute: boolean}} */
function validateRoutes(value, authority) {
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  const deleting = authority.action.action === 'delete';
  if (!deleting && value.length > 2) {
    throw new RouteTableEvidenceConflictError();
  }
  let localRoutes = 0;
  let defaultRoutes = 0;
  let otherRoutes = 0;
  for (const route of value) {
    const kind = routeKind(route, deleting);
    if (kind === 'local') {
      localRoutes += 1;
      if (
        route.DestinationCidrBlock !==
        authority.providerSpec.capabilities.networking.vpcCidr
      ) {
        throw new RouteTableEvidenceConflictError();
      }
    } else if (kind === 'default') {
      defaultRoutes += 1;
    } else {
      otherRoutes += 1;
    }
  }
  if (localRoutes > 1 || defaultRoutes > 1) {
    throw new RouteTableEvidenceConflictError();
  }
  if (localRoutes === 0) {
    if (authority.action.action === 'create' && defaultRoutes === 0) {
      throw new RouteTableEvidenceTransientError();
    }
    throw new RouteTableEvidenceConflictError();
  }
  return {
    hasNonlocalRoute: defaultRoutes > 0 || otherRoutes > 0,
  };
}

/** @param {Readonly<Record<string, any>>} routeTable @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {{associationCount: number, hasNonlocalRoute: boolean, propagationCount: number}} */
function validateRouteTableOwnershipEvidence(routeTable, authority, recovery) {
  if (
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
    throw new RouteTableEvidenceConflictError();
  }
  recovery.validateTags(
    routeTable.Tags,
    recovery.requiredTags(authority),
    authority.action.action === 'create',
  );
  const associationCount = validateAssociations(
    routeTable.Associations,
    routeTable.RouteTableId,
    authority.action.action === 'delete',
  );
  const propagationCount = validatePropagation(routeTable.PropagatingVgws);
  if (
    authority.action.action === 'create' &&
    (associationCount > 0 || propagationCount > 0)
  ) {
    throw new RouteTableEvidenceConflictError();
  }
  const { hasNonlocalRoute } = validateRoutes(routeTable.Routes, authority);
  return { associationCount, hasNonlocalRoute, propagationCount };
}

/** @param {Readonly<Record<string, any>>} routeTable @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {void} */
function validateRouteTableBaseEvidence(routeTable, authority, recovery) {
  const { associationCount, hasNonlocalRoute, propagationCount } =
    validateRouteTableOwnershipEvidence(routeTable, authority, recovery);
  if (propagationCount > 0) throw new RouteTableEvidenceConflictError();
  if (
    authority.action.action === 'create' &&
    (associationCount > 0 || hasNonlocalRoute)
  ) {
    throw new RouteTableEvidenceConflictError();
  }
}

/** @param {Readonly<Record<string, any>>} routeTable @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {void} */
function validateRouteTableDeletionEvidence(routeTable, authority, recovery) {
  const { associationCount, hasNonlocalRoute, propagationCount } =
    validateRouteTableOwnershipEvidence(routeTable, authority, recovery);
  if (associationCount > 0 || hasNonlocalRoute || propagationCount > 0) {
    throw new RouteTableEvidenceTransientError();
  }
}

/** @param {unknown[]} errors @returns {void} */
function throwStrongestEvidenceError(errors) {
  if (
    errors.some((error) => error instanceof RouteTableEvidenceConflictError)
  ) {
    throw new RouteTableEvidenceConflictError();
  }
  if (errors.some((error) => error instanceof ProviderResponseUnknownError)) {
    throw new ProviderResponseUnknownError();
  }
  if (
    errors.some((error) => error instanceof RouteTableEvidenceTransientError)
  ) {
    throw new RouteTableEvidenceTransientError();
  }
  if (errors.length > 0) throw new ProviderResponseUnknownError();
}

/**
 * Bind one exact directly owned custom route table beneath the fixed VPC. The
 * factory never owns or closes the caller's narrow EC2 client.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>} - Controller action ports.
 */
export function createAwsSingleNodeRouteTableResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('awsSingleNodeRouteTable options must be an object.');
  }
  assertSupportedKeys(options, FACTORY_KEYS, 'awsSingleNodeRouteTable options');
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeRouteTable options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError('awsSingleNodeRouteTable client must be an object.');
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeRouteTable client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeRouteTable providerScope',
  );
  const maxAttempts =
    options.maxAttempts ?? AWS_SINGLE_NODE_ROUTE_TABLE_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_ROUTE_TABLE_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeRouteTable maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_ROUTE_TABLE_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeRouteTable waitForRetry must be a function.',
    );
  }

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeRouteTableResourceUnknownError();
    }
  }

  /** @param {string} routeTableId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeExactOnce(routeTableId) {
    let response;
    try {
      response = await client.describeRouteTables(
        deepFreeze({ RouteTableIds: [routeTableId] }),
      );
    } catch (error) {
      if (routeTableNotFound(error)) return null;
      throw new ProviderResponseUnknownError();
    }
    return oneRouteTableFromResponse(response, routeTableId);
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<{records: Readonly<Record<string, any>>[], nextToken: string|null}>} */
  async function readDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeRouteTables(request);
    } catch {
      throw new ProviderResponseUnknownError();
    }
    const observed = discoveryPage(response);
    return {
      records: observed.routeTables,
      nextToken: observed.nextToken,
    };
  }

  const recovery = createAwsTaggedEc2RecoveryKernel({
    baseTags: BASE_RESERVED_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_ROUTE_TABLE_DISCOVERY_MAX_RESULTS,
    idKey: 'RouteTableId',
    idPattern: ROUTE_TABLE_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_ROUTE_TABLE_MAX_DISCOVERY_PAGES,
    maxTags: MAX_ROUTE_TABLE_TAGS,
    readDiscoveryPage,
    readExact: describeExactOnce,
  });
  /** Successful create responses are only ephemeral exact-read locators. */
  const candidateIds = new Map();

  /** @param {Readonly<Record<string, any>>} authority @returns {string} */
  function createClientToken(authority) {
    return getAwsSingleNodeRouteTableCreateClientToken(
      authority.action.actionId,
      authority.ownershipNonce,
    );
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>[]>} */
  async function readLogicalMatches(authority) {
    /** @type {Readonly<{discovered: Readonly<Record<string, any>>|null, exact: Readonly<Record<string, any>>|null, exactId: string|null}>|null} */
    let identity = null;
    const errors = [];
    try {
      identity = await recovery.readIdentityEvidence(authority, {
        useDiscoveredId: true,
      });
    } catch (error) {
      errors.push(error);
    }
    const discovered = identity?.discovered ?? null;
    let exact = identity?.exact ?? null;
    let exactId = identity?.exactId ?? null;
    const candidateId = candidateIds.get(createClientToken(authority)) ?? null;
    const independentlyKnownExactId =
      authority.priorBinding?.providerResourceId ?? candidateId;
    if (candidateId !== null && exactId !== null && candidateId !== exactId) {
      errors.push(new RouteTableEvidenceConflictError());
    }
    if (independentlyKnownExactId !== null && exactId === null) {
      exactId = independentlyKnownExactId;
      try {
        exact = await describeExactOnce(independentlyKnownExactId);
      } catch (error) {
        errors.push(error);
      }
    }
    const records = [discovered, exact].filter((record) => record !== null);
    for (const record of records) {
      try {
        if (authority.action.action === 'delete') {
          validateRouteTableDeletionEvidence(record, authority, recovery);
        } else {
          validateRouteTableBaseEvidence(record, authority, recovery);
        }
      } catch (error) {
        errors.push(error);
      }
    }
    const observedIds = new Set(records.map((record) => record.RouteTableId));
    if (exactId !== null) observedIds.add(exactId);
    if (observedIds.size > 1) {
      errors.push(new RouteTableEvidenceConflictError());
    }
    throwStrongestEvidenceError(errors);

    if (discovered === null && exact === null) return [];
    if (discovered === null || exact === null) {
      throw new RouteTableEvidenceTransientError();
    }
    return [exact];
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    if (authority.action.action === 'noop') return;
    let matches;
    try {
      matches = await readLogicalMatches(authority);
    } catch (error) {
      if (error instanceof RouteTableEvidenceConflictError) {
        throw new AwsSingleNodeRouteTableResourceConflictError();
      }
      if (
        authority.action.action === 'delete' &&
        error instanceof RouteTableEvidenceTransientError
      ) {
        return;
      }
      throw new AwsSingleNodeRouteTableResourceUnknownError();
    }
    if (authority.action.action === 'delete') {
      if (matches.length === 0) return;
      const routeTableId = authority.priorBinding.providerResourceId;
      try {
        await client.deleteRouteTable(
          deepFreeze({ RouteTableId: routeTableId }),
        );
      } catch (error) {
        if (routeTableNotFound(error)) return;
        if (
          errorNamed(error, 'DependencyViolation') ||
          errorNamed(error, 'IncorrectState')
        ) {
          return;
        }
        throw new AwsSingleNodeRouteTableResourceUnknownError();
      }
      return;
    }
    if (matches.length === 1) return;
    let response;
    try {
      response = await client.createRouteTable(
        createRouteTableRequest(authority, recovery),
      );
    } catch (error) {
      if (errorNamed(error, 'IdempotentParameterMismatch')) {
        throw new AwsSingleNodeRouteTableResourceConflictError();
      }
      throw new AwsSingleNodeRouteTableResourceUnknownError();
    }
    const token = createClientToken(authority);
    let routeTableId;
    try {
      routeTableId = candidateRouteTableId(response, token);
    } catch (error) {
      if (error instanceof RouteTableEvidenceConflictError) {
        throw new AwsSingleNodeRouteTableResourceConflictError();
      }
      throw new AwsSingleNodeRouteTableResourceUnknownError();
    }
    const priorCandidateId = candidateIds.get(token);
    if (priorCandidateId !== undefined && priorCandidateId !== routeTableId) {
      throw new AwsSingleNodeRouteTableResourceConflictError();
    }
    candidateIds.set(token, routeTableId);
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const matches = await readLogicalMatches(authority);
        if (matches.length === 1) {
          if (authority.action.action === 'delete') {
            return Object.freeze({ status: 'not-converged' });
          }
          const routeTable = matches[0];
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
              ownershipMode: authority.action.ownershipMode,
              onDestroy: authority.action.onDestroy,
              dependencyBindings: authority.dependencyBindings,
              providerType: PROVIDER_TYPE,
              providerResourceId: routeTable.RouteTableId,
              providerScopeId: providerScope.providerScopeId,
              ownershipNonce: authority.ownershipNonce,
              createdByActionId: authority.action.actionId,
            });
          candidateIds.delete(createClientToken(authority));
          return deepFreeze({ status: 'converged', binding });
        }
        if (authority.action.action === 'delete') {
          candidateIds.delete(createClientToken(authority));
          return deepFreeze({ status: 'converged', binding: null });
        }
      } catch (error) {
        if (error instanceof RouteTableEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof RouteTableEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeRouteTableResourceUnknownError();
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
  AWS_SINGLE_NODE_ROUTE_TABLE_CREATE_CLIENT_TOKEN_DOMAIN,
  AWS_SINGLE_NODE_ROUTE_TABLE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_ROUTE_TABLE_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_ROUTE_TABLE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_ROUTE_TABLE_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_ROUTE_TABLE_STATE_DIGEST_DOMAIN,
  AwsSingleNodeRouteTableResourceConflictError,
  AwsSingleNodeRouteTableResourceUnknownError,
  createAwsSingleNodeRouteTableResource,
  getAwsSingleNodeRouteTableCreateClientToken,
  getAwsSingleNodeRouteTableStateDigest,
};
