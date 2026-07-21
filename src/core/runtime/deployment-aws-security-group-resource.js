/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { sha256Base64Url } from './content-id.js';
import {
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import { getAwsSingleNodeVpcStateDigest } from './deployment-aws-vpc-resource.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import {
  AwsTaggedEc2RecoveryConflictError as SecurityGroupEvidenceConflictError,
  AwsTaggedEc2RecoveryTransientError as SecurityGroupEvidenceTransientError,
  AwsTaggedEc2RecoveryUnknownError as ProviderResponseUnknownError,
  createAwsTaggedEc2RecoveryKernel,
} from './deployment-aws-tagged-ec2-recovery.js';

export const AWS_SINGLE_NODE_SECURITY_GROUP_NAME = 'wharfie-single-node';
export const AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION =
  'Wharfie single-node application security group.';
export const AWS_SINGLE_NODE_SECURITY_GROUP_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_SECURITY_GROUP_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS = 1000;
export const AWS_SINGLE_NODE_SECURITY_GROUP_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-security-group-state:v1';

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
  'createSecurityGroup',
  'describeSecurityGroups',
  'deleteSecurityGroup',
]);
const RESOURCE_KEY = 'network-security-group';
const PROVIDER_TYPE = 'ec2-security-group';
const SECURITY_GROUP_ID_PATTERN = /^sg-[0-9a-f]{8,32}$/;
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const MAX_SECURITY_GROUP_TAGS = 50;

const BASE_RESERVED_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-security-group',
  'wharfie:retention': 'purge',
  'wharfie:schema-version': '2',
});

const VPC_DEPENDENCY = Object.freeze({
  resourceKey: 'network-vpc',
  providerType: 'ec2-vpc',
  role: Object.freeze({ kind: 'vpc', version: 1 }),
});

/** Exact controller authority or present provider evidence is contradictory. */
export class AwsSingleNodeSecurityGroupResourceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node security group resource conflicts with its exact contract.',
    );
    this.name = 'AwsSingleNodeSecurityGroupResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_SECURITY_GROUP_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeSecurityGroupResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node security group resource state is unknown.');
    this.name = 'AwsSingleNodeSecurityGroupResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_SECURITY_GROUP_RESOURCE_UNKNOWN';
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
function securityGroupNotFound(error) {
  return (
    errorNamed(error, 'InvalidGroup.NotFound') ||
    errorNamed(error, 'InvalidSecurityGroupID.NotFound')
  );
}

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Derive the exact provider-observable no-ingress/public-egress policy.
 * @param {unknown} value - Exact AWS single-node provider specification.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - State digest.
 */
export function getAwsSingleNodeSecurityGroupStateDigest(value) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeSecurityGroupState providerSpec',
  );
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2SecurityGroupState',
    groupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
    description: AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
    ingressRules: [],
    egressRules: [
      {
        protocol: 'all',
        ports: 'all',
        destination: {
          kind: 'ipv4-cidr',
          value: providerSpec.capabilities.networking.egressCidr,
        },
      },
    ],
    onDestroy: 'purge',
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_SECURITY_GROUP_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {Readonly<import('@aws-sdk/client-ec2').CreateSecurityGroupCommandInput>} */
function createSecurityGroupRequest(authority, recovery) {
  return deepFreeze({
    GroupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
    Description: AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
    VpcId: authority.vpcId,
    TagSpecifications: [
      {
        ResourceType: 'security-group',
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
 * @param {Readonly<Record<string, any>>} providerSpec - Fixed provider intent.
 * @returns {Readonly<{vpcBinding: Readonly<Record<string, any>>, vpcId: string, dependencyBindings: Readonly<Array<{resourceKey: string, bindingId: string}>>}>}
 */
function resolveVpcDependencyAuthority(
  plan,
  head,
  actionIndex,
  providerScope,
  providerSpec,
) {
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
  const expectedVpcDigest = getAwsSingleNodeVpcStateDigest(providerSpec);
  const observedVpcDigest =
    plan.operation === 'destroy'
      ? dependencyAction?.before?.stateDigest
      : dependencyAction?.after?.stateDigest;
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
    !sameJson(observedVpcDigest, expectedVpcDigest) ||
    !vpcDependencyBindingMatches(vpcBinding, plan, providerScope) ||
    (dependencyAction.action === 'create' &&
      vpcBinding.createdByActionId !== dependencyAction.actionId)
  ) {
    throw new AwsSingleNodeSecurityGroupResourceConflictError();
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
    SECURITY_GROUP_ID_PATTERN.test(binding.providerResourceId) &&
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
      'awsSingleNodeSecurityGroup action context must be an object.',
    );
  }
  assertExactKeys(
    value,
    ACTION_CONTEXT_KEYS,
    'awsSingleNodeSecurityGroup context',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeSecurityGroup context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeSecurityGroup context.head',
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
    throw new AwsSingleNodeSecurityGroupResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeSecurityGroupResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.resourceKey !== RESOURCE_KEY ||
    !sameJson(action.capability, { kind: 'networking', version: 1 }) ||
    !sameJson(action.role, { kind: 'security-group', version: 1 }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'purge' ||
    !sameJson(action.dependsOn, [VPC_DEPENDENCY.resourceKey])
  ) {
    throw new AwsSingleNodeSecurityGroupResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeSecurityGroup context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeSecurityGroupResourceConflictError();
  }
  const dependencies = resolveVpcDependencyAuthority(
    plan,
    head,
    value.actionIndex,
    providerScope,
    canonicalProviderSpec,
  );
  const stateDigest = getAwsSingleNodeSecurityGroupStateDigest(
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
      throw new AwsSingleNodeSecurityGroupResourceConflictError();
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
      throw new AwsSingleNodeSecurityGroupResourceConflictError();
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
      throw new AwsSingleNodeSecurityGroupResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeSecurityGroupResourceConflictError();
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
function candidateSecurityGroupId(value) {
  if (!isPlainObject(value)) return null;
  return typeof value.GroupId === 'string' &&
    SECURITY_GROUP_ID_PATTERN.test(value.GroupId)
    ? value.GroupId
    : null;
}

/** @param {unknown} response @param {string} exactSecurityGroupId @returns {Readonly<Record<string, any>>} */
function oneSecurityGroupFromResponse(response, exactSecurityGroupId) {
  if (!isPlainObject(response) || !Array.isArray(response.SecurityGroups)) {
    throw new ProviderResponseUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new SecurityGroupEvidenceConflictError();
  }
  if (response.SecurityGroups.length === 0) {
    throw new ProviderResponseUnknownError();
  }
  if (response.SecurityGroups.length !== 1) {
    throw new SecurityGroupEvidenceConflictError();
  }
  const securityGroup = response.SecurityGroups[0];
  if (
    !isPlainObject(securityGroup) ||
    typeof securityGroup.GroupId !== 'string' ||
    !SECURITY_GROUP_ID_PATTERN.test(securityGroup.GroupId)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (securityGroup.GroupId !== exactSecurityGroupId) {
    throw new SecurityGroupEvidenceConflictError();
  }
  return securityGroup;
}

/** @param {unknown} response @returns {{securityGroups: Readonly<Record<string, any>>[], nextToken: string|null}} */
function securityGroupPage(response) {
  if (!isPlainObject(response) || !Array.isArray(response.SecurityGroups)) {
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
  const securityGroups = [];
  for (const securityGroup of response.SecurityGroups) {
    if (
      !isPlainObject(securityGroup) ||
      typeof securityGroup.GroupId !== 'string' ||
      !SECURITY_GROUP_ID_PATTERN.test(securityGroup.GroupId)
    ) {
      throw new ProviderResponseUnknownError();
    }
    securityGroups.push(securityGroup);
  }
  return { securityGroups, nextToken };
}

/** @param {unknown} value @returns {void} */
function validateOptionalDescription(value) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') throw new ProviderResponseUnknownError();
}

/** @param {unknown} value @param {string} key @returns {Readonly<Record<string, any>>[]} */
function validateRangeArray(value, key) {
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  for (const item of value) {
    if (
      !isPlainObject(item) ||
      typeof item[key] !== 'string' ||
      item[key].length === 0
    ) {
      throw new ProviderResponseUnknownError();
    }
    validateOptionalDescription(item.Description);
  }
  return value;
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>[]} */
function validateUserIdGroupPairs(value) {
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  for (const pair of value) {
    if (!isPlainObject(pair)) throw new ProviderResponseUnknownError();
    const identifiers = [
      pair.GroupId,
      pair.GroupName,
      pair.UserId,
      pair.VpcId,
      pair.VpcPeeringConnectionId,
    ].filter((candidate) => candidate !== undefined && candidate !== null);
    if (
      identifiers.length === 0 ||
      identifiers.some(
        (candidate) => typeof candidate !== 'string' || candidate.length === 0,
      )
    ) {
      throw new ProviderResponseUnknownError();
    }
    validateOptionalDescription(pair.Description);
  }
  return value;
}

/** @param {unknown} permission @returns {Readonly<Record<string, any>>} */
function validatePermissionShape(permission) {
  if (
    !isPlainObject(permission) ||
    typeof permission.IpProtocol !== 'string' ||
    permission.IpProtocol.length === 0
  ) {
    throw new ProviderResponseUnknownError();
  }
  for (const key of ['FromPort', 'ToPort']) {
    if (
      permission[key] !== undefined &&
      permission[key] !== null &&
      !Number.isSafeInteger(permission[key])
    ) {
      throw new ProviderResponseUnknownError();
    }
  }
  const collections = [
    ['IpRanges', 'CidrIp'],
    ['Ipv6Ranges', 'CidrIpv6'],
    ['PrefixListIds', 'PrefixListId'],
  ];
  /** @type {Record<string, Readonly<Record<string, any>>[]>} */
  const normalizedCollections = {};
  for (const [field, key] of collections) {
    normalizedCollections[field] =
      permission[field] === undefined
        ? []
        : validateRangeArray(permission[field], key);
  }
  normalizedCollections.UserIdGroupPairs =
    permission.UserIdGroupPairs === undefined
      ? []
      : validateUserIdGroupPairs(permission.UserIdGroupPairs);
  return {
    ...permission,
    ...normalizedCollections,
  };
}

/** @param {Readonly<Record<string, any>>} value @param {Readonly<Record<string, any>>} authority @returns {void} */
function validateSecurityGroupRules(value, authority) {
  if (!Array.isArray(value.IpPermissions)) {
    throw new ProviderResponseUnknownError();
  }
  for (const permission of value.IpPermissions) {
    validatePermissionShape(permission);
  }
  if (value.IpPermissions.length !== 0) {
    throw new SecurityGroupEvidenceConflictError();
  }
  if (!Array.isArray(value.IpPermissionsEgress)) {
    throw new ProviderResponseUnknownError();
  }
  const normalizedEgress = value.IpPermissionsEgress.map((permission) =>
    validatePermissionShape(permission),
  );
  if (value.IpPermissionsEgress.length === 0) {
    if (authority.action.action === 'create') {
      throw new SecurityGroupEvidenceTransientError();
    }
    throw new SecurityGroupEvidenceConflictError();
  }
  if (value.IpPermissionsEgress.length !== 1) {
    throw new SecurityGroupEvidenceConflictError();
  }
  const rule = normalizedEgress[0];
  const ipRanges = rule.IpRanges;
  if (
    rule.IpProtocol !== '-1' ||
    (rule.FromPort !== undefined && rule.FromPort !== null) ||
    (rule.ToPort !== undefined && rule.ToPort !== null) ||
    ipRanges.length !== 1 ||
    ipRanges[0].CidrIp !==
      authority.providerSpec.capabilities.networking.egressCidr ||
    (ipRanges[0].Description !== undefined &&
      ipRanges[0].Description !== null) ||
    rule.Ipv6Ranges.length !== 0 ||
    rule.PrefixListIds.length !== 0 ||
    rule.UserIdGroupPairs.length !== 0
  ) {
    throw new SecurityGroupEvidenceConflictError();
  }
}

/** @param {Readonly<Record<string, any>>} securityGroup @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {void} */
function validateSecurityGroupEvidence(securityGroup, authority, recovery) {
  if (
    typeof securityGroup.GroupId !== 'string' ||
    !SECURITY_GROUP_ID_PATTERN.test(securityGroup.GroupId) ||
    typeof securityGroup.OwnerId !== 'string' ||
    securityGroup.OwnerId.length === 0 ||
    typeof securityGroup.VpcId !== 'string' ||
    !VPC_ID_PATTERN.test(securityGroup.VpcId) ||
    typeof securityGroup.GroupName !== 'string' ||
    securityGroup.GroupName.length === 0 ||
    typeof securityGroup.Description !== 'string' ||
    securityGroup.Description.length === 0
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    securityGroup.OwnerId !== authority.plan.providerScope.accountId ||
    securityGroup.VpcId !== authority.vpcId ||
    securityGroup.GroupName !== AWS_SINGLE_NODE_SECURITY_GROUP_NAME ||
    securityGroup.Description !== AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION
  ) {
    throw new SecurityGroupEvidenceConflictError();
  }
  if (
    securityGroup.SecurityGroupArn !== undefined &&
    securityGroup.SecurityGroupArn !== null
  ) {
    if (typeof securityGroup.SecurityGroupArn !== 'string') {
      throw new ProviderResponseUnknownError();
    }
    const expectedArn = `arn:${authority.plan.providerScope.partition}:ec2:${authority.plan.providerScope.region}:${authority.plan.providerScope.accountId}:security-group/${securityGroup.GroupId}`;
    if (securityGroup.SecurityGroupArn !== expectedArn) {
      throw new SecurityGroupEvidenceConflictError();
    }
  }
  if (securityGroup.Tags === null) throw new ProviderResponseUnknownError();
  recovery.validateTags(
    securityGroup.Tags,
    recovery.requiredTags(authority),
    authority.action.action === 'create',
  );
  if (authority.action.action !== 'delete') {
    validateSecurityGroupRules(securityGroup, authority);
  }
}

/** @param {Readonly<Record<string, any>>} securityGroup @param {Readonly<Record<string, any>>} authority @returns {void} */
function validateNaturalScanRecord(securityGroup, authority) {
  if (
    typeof securityGroup.GroupId !== 'string' ||
    !SECURITY_GROUP_ID_PATTERN.test(securityGroup.GroupId) ||
    typeof securityGroup.GroupName !== 'string' ||
    securityGroup.GroupName.length === 0 ||
    typeof securityGroup.OwnerId !== 'string' ||
    securityGroup.OwnerId.length === 0 ||
    typeof securityGroup.VpcId !== 'string' ||
    !VPC_ID_PATTERN.test(securityGroup.VpcId)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    securityGroup.OwnerId !== authority.plan.providerScope.accountId ||
    securityGroup.VpcId !== authority.vpcId
  ) {
    throw new SecurityGroupEvidenceConflictError();
  }
}

/** @param {unknown[]} errors @returns {void} */
function throwStrongestEvidenceError(errors) {
  if (
    errors.some((error) => error instanceof SecurityGroupEvidenceConflictError)
  ) {
    throw new SecurityGroupEvidenceConflictError();
  }
  if (errors.some((error) => error instanceof ProviderResponseUnknownError)) {
    throw new ProviderResponseUnknownError();
  }
  if (
    errors.some((error) => error instanceof SecurityGroupEvidenceTransientError)
  ) {
    throw new SecurityGroupEvidenceTransientError();
  }
  if (errors.length > 0) throw new ProviderResponseUnknownError();
}

/**
 * Bind one exact directly owned application security group beneath the fixed
 * VPC. The factory never owns or closes the caller's narrow EC2 client.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>} - Controller action ports.
 */
export function createAwsSingleNodeSecurityGroupResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeSecurityGroup options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeSecurityGroup options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeSecurityGroup options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError('awsSingleNodeSecurityGroup client must be an object.');
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeSecurityGroup client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeSecurityGroup providerScope',
  );
  const maxAttempts =
    options.maxAttempts ?? AWS_SINGLE_NODE_SECURITY_GROUP_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_SECURITY_GROUP_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeSecurityGroup maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_SECURITY_GROUP_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeSecurityGroup waitForRetry must be a function.',
    );
  }

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeSecurityGroupResourceUnknownError();
    }
  }

  /** @param {string} securityGroupId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeExactOnce(securityGroupId) {
    let response;
    try {
      response = await client.describeSecurityGroups(
        deepFreeze({ GroupIds: [securityGroupId] }),
      );
    } catch (error) {
      if (securityGroupNotFound(error)) return null;
      throw new ProviderResponseUnknownError();
    }
    return oneSecurityGroupFromResponse(response, securityGroupId);
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<{records: Readonly<Record<string, any>>[], nextToken: string|null}>} */
  async function readDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeSecurityGroups(request);
    } catch {
      throw new ProviderResponseUnknownError();
    }
    const observed = securityGroupPage(response);
    return {
      records: observed.securityGroups,
      nextToken: observed.nextToken,
    };
  }

  const recovery = createAwsTaggedEc2RecoveryKernel({
    baseTags: BASE_RESERVED_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS,
    idKey: 'GroupId',
    idPattern: SECURITY_GROUP_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES,
    maxTags: MAX_SECURITY_GROUP_TAGS,
    readDiscoveryPage,
    readExact: describeExactOnce,
  });

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function discoverNaturalSlotOnce(authority) {
    const filters = deepFreeze([{ Name: 'vpc-id', Values: [authority.vpcId] }]);
    const seenSecurityGroupIds = new Set();
    const matches = new Map();
    const seenTokens = new Set();
    let nextToken = null;
    for (
      let page = 1;
      page <= AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES;
      page += 1
    ) {
      let response;
      try {
        response = await client.describeSecurityGroups(
          deepFreeze({
            Filters: filters,
            MaxResults: AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS,
            ...(nextToken === null ? {} : { NextToken: nextToken }),
          }),
        );
      } catch {
        throw new ProviderResponseUnknownError();
      }
      const observed = securityGroupPage(response);
      for (const securityGroup of observed.securityGroups) {
        validateNaturalScanRecord(securityGroup, authority);
        if (seenSecurityGroupIds.has(securityGroup.GroupId)) {
          throw new SecurityGroupEvidenceConflictError();
        }
        seenSecurityGroupIds.add(securityGroup.GroupId);
        if (
          securityGroup.GroupName.toLowerCase() ===
          AWS_SINGLE_NODE_SECURITY_GROUP_NAME.toLowerCase()
        ) {
          matches.set(securityGroup.GroupId, securityGroup);
          if (matches.size > 1) {
            throw new SecurityGroupEvidenceConflictError();
          }
        }
      }
      if (observed.nextToken === null) break;
      if (
        page === AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new ProviderResponseUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    return /** @type {Readonly<Record<string, any>>|null} */ (
      [...matches.values()][0] ?? null
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
        validateSecurityGroupEvidence(record, authority, recovery);
      } catch (error) {
        errors.push(error);
      }
    }
    const observedIds = new Set(records.map((record) => record.GroupId));
    if (exactId !== null) observedIds.add(exactId);
    if (observedIds.size > 1) {
      errors.push(new SecurityGroupEvidenceConflictError());
    }
    throwStrongestEvidenceError(errors);

    if (discovered === null && exact === null && slot === null) return [];
    if (authority.action.action === 'delete') {
      if (discovered === null || exact === null || slot === null) {
        throw new SecurityGroupEvidenceTransientError();
      }
      return [exact];
    }
    if (discovered === null || exact === null || slot === null) {
      throw new SecurityGroupEvidenceTransientError();
    }
    return [exact];
  }

  /** @param {unknown} error @returns {boolean} */
  function mutationNeedsReadback(error) {
    return (
      securityGroupNotFound(error) ||
      errorNamed(error, 'InvalidGroup.Duplicate') ||
      errorNamed(error, 'InvalidGroup.InUse') ||
      errorNamed(error, 'InvalidVpcID.NotFound') ||
      errorNamed(error, 'DependencyViolation')
    );
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    if (authority.action.action === 'noop') return;
    let matches;
    try {
      matches = await readLogicalMatches(authority);
    } catch (error) {
      if (error instanceof SecurityGroupEvidenceConflictError) {
        throw new AwsSingleNodeSecurityGroupResourceConflictError();
      }
      if (
        authority.action.action === 'delete' &&
        error instanceof SecurityGroupEvidenceTransientError
      ) {
        return;
      }
      throw new AwsSingleNodeSecurityGroupResourceUnknownError();
    }
    if (authority.action.action === 'delete') {
      if (matches.length === 0) return;
      const securityGroupId = authority.priorBinding.providerResourceId;
      try {
        await client.deleteSecurityGroup(
          deepFreeze({ GroupId: securityGroupId }),
        );
      } catch (error) {
        if (mutationNeedsReadback(error)) return;
        throw new AwsSingleNodeSecurityGroupResourceUnknownError();
      }
      return;
    }
    if (matches.length === 1) return;
    if (!recovery.claimCreateAttempt(authority)) {
      throw new AwsSingleNodeSecurityGroupResourceUnknownError();
    }
    let response;
    try {
      response = await client.createSecurityGroup(
        createSecurityGroupRequest(authority, recovery),
      );
    } catch (error) {
      if (mutationNeedsReadback(error)) return;
      throw new AwsSingleNodeSecurityGroupResourceUnknownError();
    }
    const securityGroupId = candidateSecurityGroupId(response);
    if (securityGroupId === null) {
      throw new AwsSingleNodeSecurityGroupResourceUnknownError();
    }
    try {
      recovery.rememberCandidate(authority, securityGroupId);
    } catch (error) {
      if (error instanceof SecurityGroupEvidenceConflictError) {
        throw new AwsSingleNodeSecurityGroupResourceConflictError();
      }
      throw new AwsSingleNodeSecurityGroupResourceUnknownError();
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
          const securityGroup = matches[0];
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
              providerResourceId: securityGroup.GroupId,
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
        if (error instanceof SecurityGroupEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof SecurityGroupEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeSecurityGroupResourceUnknownError();
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
  AWS_SINGLE_NODE_SECURITY_GROUP_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
  AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_SECURITY_GROUP_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
  AWS_SINGLE_NODE_SECURITY_GROUP_STATE_DIGEST_DOMAIN,
  AwsSingleNodeSecurityGroupResourceConflictError,
  AwsSingleNodeSecurityGroupResourceUnknownError,
  createAwsSingleNodeSecurityGroupResource,
  getAwsSingleNodeSecurityGroupStateDigest,
};
