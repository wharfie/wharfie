/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { sha256Base64Url } from './content-id.js';
import {
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import {
  AwsTaggedEc2RecoveryConflictError as SubnetEvidenceConflictError,
  AwsTaggedEc2RecoveryTransientError as SubnetEvidenceTransientError,
  AwsTaggedEc2RecoveryUnknownError as ProviderResponseUnknownError,
  createAwsTaggedEc2RecoveryKernel,
} from './deployment-aws-tagged-ec2-recovery.js';

export const AWS_SINGLE_NODE_SUBNET_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_SUBNET_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_SUBNET_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_SUBNET_DISCOVERY_MAX_RESULTS = 100;
export const AWS_SINGLE_NODE_SUBNET_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-subnet-state:v1';

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
  'createSubnet',
  'describeSubnets',
  'deleteSubnet',
]);
const RESOURCE_KEY = 'network-subnet';
const PROVIDER_TYPE = 'ec2-subnet';
const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,32}$/;
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const SUBNET_CIDR_ASSOCIATION_ID_PATTERN = /^subnet-cidr-assoc-[0-9a-f]{8,32}$/;
const SUBNET_STATES = new Set([
  'pending',
  'available',
  'unavailable',
  'failed',
  'failed-insufficient-capacity',
]);
const MAX_SUBNET_TAGS = 50;

const BASE_RESERVED_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-subnet',
  'wharfie:retention': 'purge',
  'wharfie:schema-version': '2',
});

const VPC_DEPENDENCY = Object.freeze({
  resourceKey: 'network-vpc',
  providerType: 'ec2-vpc',
  role: Object.freeze({ kind: 'vpc', version: 1 }),
});

/** Exact controller authority or present provider evidence is contradictory. */
export class AwsSingleNodeSubnetResourceConflictError extends Error {
  constructor() {
    super('AWS single-node subnet resource conflicts with its exact contract.');
    this.name = 'AwsSingleNodeSubnetResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_SUBNET_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeSubnetResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node subnet resource state is unknown.');
    this.name = 'AwsSingleNodeSubnetResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_SUBNET_RESOURCE_UNKNOWN';
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
 * Derive the exact intrinsic subnet state. The dynamically allocated parent
 * VPC identity belongs to the binding's dependency lineage rather than this
 * plan-time digest.
 * @param {unknown} value - Exact AWS single-node provider specification.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - State digest.
 */
export function getAwsSingleNodeSubnetStateDigest(value) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeSubnetState providerSpec',
  );
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2SubnetState',
    cidrBlock: providerSpec.capabilities.networking.subnetCidr,
    availabilityZoneId: providerSpec.placement.availabilityZoneId,
    defaultForAz: false,
    ipv6Native: false,
    assignIpv6AddressOnCreation: false,
    mapPublicIpOnLaunch: false,
    internetGatewayBlockMode: 'off',
    onDestroy: 'purge',
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_SUBNET_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {Readonly<import('@aws-sdk/client-ec2').CreateSubnetCommandInput>} */
function createSubnetRequest(authority, recovery) {
  return deepFreeze({
    VpcId: authority.vpcId,
    CidrBlock: authority.providerSpec.capabilities.networking.subnetCidr,
    AvailabilityZoneId: authority.providerSpec.placement.availabilityZoneId,
    TagSpecifications: [
      {
        ResourceType: 'subnet',
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
    throw new AwsSingleNodeSubnetResourceConflictError();
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
    SUBNET_ID_PATTERN.test(binding.providerResourceId) &&
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
      'awsSingleNodeSubnet action context must be an object.',
    );
  }
  assertExactKeys(value, ACTION_CONTEXT_KEYS, 'awsSingleNodeSubnet context');
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeSubnet context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeSubnet context.head',
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
    throw new AwsSingleNodeSubnetResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeSubnetResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.resourceKey !== RESOURCE_KEY ||
    !sameJson(action.capability, { kind: 'networking', version: 1 }) ||
    !sameJson(action.role, { kind: 'subnet', version: 1 }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'purge' ||
    !sameJson(action.dependsOn, [VPC_DEPENDENCY.resourceKey])
  ) {
    throw new AwsSingleNodeSubnetResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeSubnet context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeSubnetResourceConflictError();
  }
  const dependencies = resolveVpcDependencyAuthority(
    plan,
    head,
    value.actionIndex,
    providerScope,
  );
  const stateDigest = getAwsSingleNodeSubnetStateDigest(canonicalProviderSpec);
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
      throw new AwsSingleNodeSubnetResourceConflictError();
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
      throw new AwsSingleNodeSubnetResourceConflictError();
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
      throw new AwsSingleNodeSubnetResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeSubnetResourceConflictError();
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

/** @param {unknown} value @returns {string|null} */
function candidateSubnetId(value) {
  if (!isPlainObject(value) || !isPlainObject(value.Subnet)) return null;
  return typeof value.Subnet.SubnetId === 'string' &&
    SUBNET_ID_PATTERN.test(value.Subnet.SubnetId)
    ? value.Subnet.SubnetId
    : null;
}

/** @param {unknown} response @param {string} exactSubnetId @returns {Readonly<Record<string, any>>} */
function oneSubnetFromResponse(response, exactSubnetId) {
  if (!isPlainObject(response) || !Array.isArray(response.Subnets)) {
    throw new ProviderResponseUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new SubnetEvidenceConflictError();
  }
  if (response.Subnets.length === 0) {
    throw new ProviderResponseUnknownError();
  }
  if (response.Subnets.length !== 1) {
    throw new SubnetEvidenceConflictError();
  }
  const subnet = response.Subnets[0];
  if (
    !isPlainObject(subnet) ||
    typeof subnet.SubnetId !== 'string' ||
    !SUBNET_ID_PATTERN.test(subnet.SubnetId)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (subnet.SubnetId !== exactSubnetId) {
    throw new SubnetEvidenceConflictError();
  }
  return subnet;
}

/** @param {unknown} response @returns {{subnets: Readonly<Record<string, any>>[], nextToken: string|null}} */
function discoveryPage(response) {
  if (!isPlainObject(response) || !Array.isArray(response.Subnets)) {
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
  const subnets = [];
  for (const subnet of response.Subnets) {
    if (
      !isPlainObject(subnet) ||
      typeof subnet.SubnetId !== 'string' ||
      !SUBNET_ID_PATTERN.test(subnet.SubnetId)
    ) {
      throw new ProviderResponseUnknownError();
    }
    subnets.push(subnet);
  }
  return { subnets, nextToken };
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
  throw new SubnetEvidenceConflictError();
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
    throw new SubnetEvidenceConflictError();
  }
  throw new ProviderResponseUnknownError();
}

/** @param {Readonly<Record<string, any>>} subnet @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {void} */
function validateSubnetOwnershipEvidence(subnet, authority, recovery) {
  if (
    typeof subnet.SubnetId !== 'string' ||
    !SUBNET_ID_PATTERN.test(subnet.SubnetId) ||
    typeof subnet.OwnerId !== 'string' ||
    typeof subnet.VpcId !== 'string' ||
    !VPC_ID_PATTERN.test(subnet.VpcId) ||
    typeof subnet.State !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (!SUBNET_STATES.has(subnet.State)) {
    throw new ProviderResponseUnknownError();
  }
  if (
    subnet.OwnerId !== authority.plan.providerScope.accountId ||
    subnet.VpcId !== authority.vpcId
  ) {
    throw new SubnetEvidenceConflictError();
  }
  recovery.validateTags(
    subnet.Tags,
    recovery.requiredTags(authority),
    authority.action.action === 'create',
  );
  if (subnet.State === 'pending' || subnet.State === 'unavailable') {
    throw new SubnetEvidenceTransientError();
  }
  if (subnet.State !== 'available') {
    throw new SubnetEvidenceConflictError();
  }
}

/** @param {Readonly<Record<string, any>>} subnet @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {void} */
function validateSubnetDeletionEvidence(subnet, authority, recovery) {
  validateSubnetOwnershipEvidence(subnet, authority, recovery);
  if (typeof subnet.DefaultForAz !== 'boolean') {
    throw new ProviderResponseUnknownError();
  }
  if (subnet.DefaultForAz) throw new SubnetEvidenceConflictError();
}

/** @param {Readonly<Record<string, any>>} subnet @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {void} */
function validateSubnetBaseEvidence(subnet, authority, recovery) {
  validateSubnetOwnershipEvidence(subnet, authority, recovery);
  if (
    typeof subnet.CidrBlock !== 'string' ||
    typeof subnet.AvailabilityZoneId !== 'string' ||
    typeof subnet.DefaultForAz !== 'boolean' ||
    typeof subnet.Ipv6Native !== 'boolean' ||
    typeof subnet.AssignIpv6AddressOnCreation !== 'boolean' ||
    typeof subnet.MapPublicIpOnLaunch !== 'boolean'
  ) {
    throw new ProviderResponseUnknownError();
  }
  validateIpv6Associations(subnet.Ipv6CidrBlockAssociationSet);
  validateBlockPublicAccessStates(subnet.BlockPublicAccessStates);
  if (
    subnet.CidrBlock !==
      authority.providerSpec.capabilities.networking.subnetCidr ||
    subnet.AvailabilityZoneId !==
      authority.providerSpec.placement.availabilityZoneId ||
    subnet.DefaultForAz ||
    subnet.Ipv6Native ||
    subnet.AssignIpv6AddressOnCreation ||
    subnet.MapPublicIpOnLaunch
  ) {
    throw new SubnetEvidenceConflictError();
  }
}

/** @param {unknown[]} errors @returns {void} */
function throwStrongestEvidenceError(errors) {
  if (errors.some((error) => error instanceof SubnetEvidenceConflictError)) {
    throw new SubnetEvidenceConflictError();
  }
  if (errors.some((error) => error instanceof ProviderResponseUnknownError)) {
    throw new ProviderResponseUnknownError();
  }
  if (errors.some((error) => error instanceof SubnetEvidenceTransientError)) {
    throw new SubnetEvidenceTransientError();
  }
  if (errors.length > 0) throw new ProviderResponseUnknownError();
}

/**
 * Bind one exact directly owned subnet beneath the fixed VPC dependency. The
 * factory never owns or closes the caller's narrow EC2 client.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>} - Controller action ports.
 */
export function createAwsSingleNodeSubnetResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('awsSingleNodeSubnet options must be an object.');
  }
  assertSupportedKeys(options, FACTORY_KEYS, 'awsSingleNodeSubnet options');
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeSubnet options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError('awsSingleNodeSubnet client must be an object.');
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(`awsSingleNodeSubnet client.${method} is required.`);
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeSubnet providerScope',
  );
  const maxAttempts =
    options.maxAttempts ?? AWS_SINGLE_NODE_SUBNET_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_SUBNET_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeSubnet maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_SUBNET_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError('awsSingleNodeSubnet waitForRetry must be a function.');
  }

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeSubnetResourceUnknownError();
    }
  }

  /** @param {string} subnetId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeExactOnce(subnetId) {
    let response;
    try {
      response = await client.describeSubnets(
        deepFreeze({ SubnetIds: [subnetId] }),
      );
    } catch (error) {
      if (subnetNotFound(error)) return null;
      throw new ProviderResponseUnknownError();
    }
    return oneSubnetFromResponse(response, subnetId);
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<{records: Readonly<Record<string, any>>[], nextToken: string|null}>} */
  async function readDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeSubnets(request);
    } catch {
      throw new ProviderResponseUnknownError();
    }
    const observed = discoveryPage(response);
    return { records: observed.subnets, nextToken: observed.nextToken };
  }

  const recovery = createAwsTaggedEc2RecoveryKernel({
    baseTags: BASE_RESERVED_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_SUBNET_DISCOVERY_MAX_RESULTS,
    idKey: 'SubnetId',
    idPattern: SUBNET_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_SUBNET_MAX_DISCOVERY_PAGES,
    maxTags: MAX_SUBNET_TAGS,
    readDiscoveryPage,
    readExact: describeExactOnce,
  });

  /** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Array<{Name: string, Values: string[]}>>} */
  function naturalSlotFilters(authority) {
    return deepFreeze([
      { Name: 'vpc-id', Values: [authority.vpcId] },
      {
        Name: 'cidr-block',
        Values: [authority.providerSpec.capabilities.networking.subnetCidr],
      },
    ]);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function discoverNaturalSlotOnce(authority) {
    const filters = naturalSlotFilters(authority);
    const subnets = new Map();
    const seenTokens = new Set();
    let nextToken = null;
    for (
      let page = 1;
      page <= AWS_SINGLE_NODE_SUBNET_MAX_DISCOVERY_PAGES;
      page += 1
    ) {
      let response;
      try {
        response = await client.describeSubnets(
          deepFreeze({
            Filters: filters,
            MaxResults: AWS_SINGLE_NODE_SUBNET_DISCOVERY_MAX_RESULTS,
            ...(nextToken === null ? {} : { NextToken: nextToken }),
          }),
        );
      } catch {
        throw new ProviderResponseUnknownError();
      }
      const observed = discoveryPage(response);
      for (const subnet of observed.subnets) {
        if (subnets.has(subnet.SubnetId)) {
          throw new SubnetEvidenceConflictError();
        }
        subnets.set(subnet.SubnetId, subnet);
        if (subnets.size > 1) throw new SubnetEvidenceConflictError();
      }
      if (observed.nextToken === null) break;
      if (
        page === AWS_SINGLE_NODE_SUBNET_MAX_DISCOVERY_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new ProviderResponseUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    return /** @type {Readonly<Record<string, any>>|null} */ (
      [...subnets.values()][0] ?? null
    );
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>[]>} */
  async function readLogicalMatches(authority) {
    /** @type {Readonly<{discovered: Readonly<Record<string, any>>|null, exact: Readonly<Record<string, any>>|null, exactId: string|null}>|null} */
    let identity = null;
    /** @type {Readonly<Record<string, any>>|null} */
    let slot = null;
    const errors = [];
    try {
      identity = await recovery.readIdentityEvidence(authority, {
        useDiscoveredId: true,
      });
    } catch (error) {
      errors.push(error);
    }
    try {
      slot = await discoverNaturalSlotOnce(authority);
    } catch (error) {
      errors.push(error);
    }

    const discovered = identity?.discovered ?? null;
    const exact = identity?.exact ?? null;
    const exactId = identity?.exactId ?? null;
    const records = [discovered, exact, slot].filter(
      (record) => record !== null,
    );
    for (const record of records) {
      try {
        if (authority.action.action === 'delete') {
          validateSubnetDeletionEvidence(record, authority, recovery);
        } else {
          validateSubnetBaseEvidence(record, authority, recovery);
        }
      } catch (error) {
        errors.push(error);
      }
    }
    const observedIds = new Set(records.map((record) => record.SubnetId));
    if (exactId !== null) observedIds.add(exactId);
    if (observedIds.size > 1) errors.push(new SubnetEvidenceConflictError());
    throwStrongestEvidenceError(errors);

    if (discovered === null && exact === null && slot === null) return [];
    if (authority.action.action === 'delete') {
      if (discovered === null || exact === null) {
        throw new SubnetEvidenceTransientError();
      }
      return [exact];
    }
    if (discovered === null || exact === null || slot === null) {
      throw new SubnetEvidenceTransientError();
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
      if (error instanceof SubnetEvidenceConflictError) {
        throw new AwsSingleNodeSubnetResourceConflictError();
      }
      if (
        authority.action.action === 'delete' &&
        error instanceof SubnetEvidenceTransientError
      ) {
        return;
      }
      throw new AwsSingleNodeSubnetResourceUnknownError();
    }
    if (authority.action.action === 'delete') {
      if (matches.length === 0) return;
      const subnetId = authority.priorBinding.providerResourceId;
      try {
        await client.deleteSubnet(deepFreeze({ SubnetId: subnetId }));
      } catch (error) {
        if (subnetNotFound(error)) return;
        if (
          errorNamed(error, 'DependencyViolation') ||
          errorNamed(error, 'IncorrectState')
        ) {
          return;
        }
        throw new AwsSingleNodeSubnetResourceUnknownError();
      }
      return;
    }
    if (matches.length === 1) return;
    if (!recovery.claimCreateAttempt(authority)) {
      throw new AwsSingleNodeSubnetResourceUnknownError();
    }
    let response;
    try {
      response = await client.createSubnet(
        createSubnetRequest(authority, recovery),
      );
    } catch {
      throw new AwsSingleNodeSubnetResourceUnknownError();
    }
    const subnetId = candidateSubnetId(response);
    if (subnetId === null) {
      throw new AwsSingleNodeSubnetResourceUnknownError();
    }
    try {
      recovery.rememberCandidate(authority, subnetId);
    } catch (error) {
      if (error instanceof SubnetEvidenceConflictError) {
        throw new AwsSingleNodeSubnetResourceConflictError();
      }
      throw new AwsSingleNodeSubnetResourceUnknownError();
    }
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
          const subnet = matches[0];
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
              providerResourceId: subnet.SubnetId,
              providerScopeId: providerScope.providerScopeId,
              ownershipNonce: authority.ownershipNonce,
              createdByActionId: authority.action.actionId,
            });
          recovery.clearCandidate(authority);
          return deepFreeze({ status: 'converged', binding });
        }
        if (authority.action.action === 'delete') {
          recovery.clearCandidate(authority);
          return deepFreeze({ status: 'converged', binding: null });
        }
      } catch (error) {
        if (error instanceof SubnetEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof SubnetEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeSubnetResourceUnknownError();
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
  AWS_SINGLE_NODE_SUBNET_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_SUBNET_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_SUBNET_STATE_DIGEST_DOMAIN,
  AwsSingleNodeSubnetResourceConflictError,
  AwsSingleNodeSubnetResourceUnknownError,
  createAwsSingleNodeSubnetResource,
  getAwsSingleNodeSubnetStateDigest,
};
