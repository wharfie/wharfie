/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider contracts are clearer than parser-specific expansions. */

import { compareCanonicalStrings } from './canonical-order.js';
import { createCanonicalJsonSha256Id } from './content-id.js';
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
import { getAwsSingleNodeManagedArtifactStateDigest } from './deployment-aws-managed-artifact-resource.js';
import { getAwsSingleNodeBootstrapBase64 } from './deployment-aws-node-bootstrap-contract.js';
import {
  AWS_SINGLE_NODE_NODE_BASE_INSTANCE_TAGS,
  AWS_SINGLE_NODE_NODE_BASE_ROOT_VOLUME_TAGS,
  AWS_SINGLE_NODE_NODE_CREATE_CLIENT_TOKEN_DOMAIN,
  AWS_SINGLE_NODE_NODE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_NODE_MAX_TAGS,
  AWS_SINGLE_NODE_NODE_ROOT_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_NODE_STATE_DIGEST_DOMAIN,
  AWS_SINGLE_NODE_NODE_VOLUME_ID_PATTERN,
  createAwsSingleNodeNodeReadableState,
  decodeAwsSingleNodeNodeCreditSpecification,
  decodeAwsSingleNodeNodeExactInstanceResponse,
  decodeAwsSingleNodeNodeExactRootVolumeResponse,
  decodeAwsSingleNodeNodeIdentityEvidence,
  decodeAwsSingleNodeNodeInstanceAttribute,
  decodeAwsSingleNodeNodeInstancePage,
  decodeAwsSingleNodeNodeInstanceState,
  decodeAwsSingleNodeNodeLifecycle,
  decodeAwsSingleNodeNodeRootVolumePage,
  decodeAwsSingleNodeNodeRootVolumePurgeEvidence,
  decodeAwsSingleNodeNodeRootVolumeState,
  decodeAwsSingleNodeNodeRunCandidateId,
  decodeAwsSingleNodeNodeTerminalRootVolumeId,
  getAwsSingleNodeNodeCreateClientToken,
  getAwsSingleNodeNodeObservedStateDigest,
  getAwsSingleNodeNodeRootVolumeTags,
  getAwsSingleNodeNodeStateDigest,
  validateAwsSingleNodeNodeManagedTags,
} from './deployment-aws-node-evidence.js';
import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import {
  AWS_EC2_INSTANCE_ID_PATTERN,
  AWS_IAM_INSTANCE_PROFILE_ID_PATTERN,
  AWS_IAM_ROLE_ID_PATTERN,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeAssociationStateDigest,
  getAwsSingleNodeRuntimeInstanceProfileName,
  getAwsSingleNodeRuntimeInstanceProfileStateDigest,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimePolicyStateDigest,
  getAwsSingleNodeRuntimeRoleStateDigest,
} from './deployment-aws-runtime-identity-contract.js';
import { getAwsSingleNodeRouteTableStateDigest } from './deployment-aws-route-table-resource.js';
import { getAwsSingleNodeSecurityGroupStateDigest } from './deployment-aws-security-group-resource.js';
import { getAwsSingleNodeSubnetStateDigest } from './deployment-aws-subnet-resource.js';
import {
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_PREFIX,
  getAwsSingleNodeSubnetRouteTableAssociationStateDigest,
} from './deployment-aws-subnet-route-table-association-resource.js';
import {
  AwsTaggedEc2RecoveryConflictError as NodeEvidenceConflictError,
  AwsTaggedEc2RecoveryTransientError as NodeEvidenceTransientError,
  AwsTaggedEc2RecoveryUnknownError as ProviderResponseUnknownError,
  createAwsTaggedEc2RecoveryKernel,
} from './deployment-aws-tagged-ec2-recovery.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import { getAwsSingleNodeResourceDefinition } from './deployment-resource-graph.js';
import { getAwsSingleNodeVpcStateDigest } from './deployment-aws-vpc-resource.js';

export {
  AWS_SINGLE_NODE_NODE_CREATE_CLIENT_TOKEN_DOMAIN,
  AWS_SINGLE_NODE_NODE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_NODE_STATE_DIGEST_DOMAIN,
  getAwsSingleNodeNodeCreateClientToken,
  getAwsSingleNodeNodeStateDigest,
} from './deployment-aws-node-evidence.js';

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
  'runInstances',
  'startInstances',
  'describeInstances',
  'describeInstanceAttribute',
  'describeInstanceCreditSpecifications',
  'describeVolumes',
  'terminateInstances',
]);
const RESOURCE_KEY = 'substrate';
const PROVIDER_TYPE = 'ec2-instance';
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,32}$/;
const SECURITY_GROUP_ID_PATTERN = /^sg-[0-9a-f]{8,32}$/;
const INTERNET_GATEWAY_ID_PATTERN = /^igw-[0-9a-f]{8,32}$/;
const ROUTE_TABLE_ID_PATTERN = /^rtb-[0-9a-f]{8,32}$/;
const DIRECT_DEPENDENCY_KEYS = Object.freeze([
  'artifact',
  'network-subnet',
  'network-default-ipv4-route',
  'network-subnet-route-table-association',
  'network-security-group',
  'runtime-role-policy',
  'runtime-identity',
  'runtime-identity-role-association',
]);
const SORTED_DIRECT_DEPENDENCY_KEYS = Object.freeze(
  [...DIRECT_DEPENDENCY_KEYS].sort(compareCanonicalStrings),
);
const UPSTREAM_AUTHORITY_KEYS = Object.freeze([
  'artifact',
  'network-vpc',
  'network-internet-gateway',
  'network-internet-gateway-attachment',
  'network-subnet',
  'network-route-table',
  'network-default-ipv4-route',
  'network-subnet-route-table-association',
  'network-security-group',
  'runtime-role',
  'runtime-role-policy',
  'runtime-identity',
  'runtime-identity-role-association',
]);

/** Exact controller authority or provider evidence is contradictory. */
export class AwsSingleNodeNodeResourceConflictError extends Error {
  constructor() {
    super('AWS single-node node resource conflicts with its exact contract.');
    this.name = 'AwsSingleNodeNodeResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_NODE_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeNodeResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node node resource state is unknown.');
    this.name = 'AwsSingleNodeNodeResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_NODE_RESOURCE_UNKNOWN';
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
    if (!Object.hasOwn(value, key))
      throw new TypeError(`${path}.${key} is required.`);
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
function instanceNotFound(error) {
  return (
    errorNamed(error, 'InvalidInstanceID.NotFound') ||
    errorNamed(error, 'InvalidInstanceId.NotFound')
  );
}

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/** @param {Readonly<Record<string, any>>} plan @returns {Readonly<Record<string, string>>} */
function nodeNameAuthority(plan) {
  return deepFreeze({
    providerScopeId: plan.providerScope.providerScopeId,
    deploymentInstanceId: plan.deploymentInstanceId,
    incarnationId: plan.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>} binding @returns {Readonly<{resourceKey: string, bindingId: string}>} */
function bindingReceipt(binding) {
  return Object.freeze({
    resourceKey: binding.resourceKey,
    bindingId: binding.bindingId,
  });
}

/** @param {Readonly<Record<string, any>>[]} bindings @returns {Readonly<Array<Readonly<{resourceKey: string, bindingId: string}>>>} */
function sortedBindingReceipts(bindings) {
  return deepFreeze(
    bindings
      .map(bindingReceipt)
      .sort((left, right) =>
        compareCanonicalStrings(left.resourceKey, right.resourceKey),
      ),
  );
}

/** @param {string} domain @param {string} prefix @param {unknown} value @returns {string} */
function syntheticProviderId(domain, prefix, value) {
  return createCanonicalJsonSha256Id({ domain, prefix, value });
}

/** @param {Map<string, Readonly<Record<string, any>>>} bindings @param {Readonly<Record<string, any>>} authority @returns {void} */
function validateSpecificDependencyProviderIds(bindings, authority) {
  /** @param {string} key @returns {string|undefined} */
  const id = (key) => bindings.get(key)?.providerResourceId;
  let artifactArn;
  let internetGatewayAttachmentId;
  let defaultRouteId;
  let subnetAssociationId;
  let runtimePolicyId;
  let runtimeAssociationId;
  try {
    artifactArn = getAwsSingleNodeManagedArtifactObjectLocation({
      providerScope: authority.plan.providerScope,
      deploymentInstanceId: authority.plan.deploymentInstanceId,
      incarnationId: authority.plan.incarnationId,
    }).arn;
    internetGatewayAttachmentId = syntheticProviderId(
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
      {
        internetGatewayId: id('network-internet-gateway'),
        vpcId: id('network-vpc'),
      },
    );
    defaultRouteId = syntheticProviderId(
      AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_DOMAIN,
      AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_PREFIX,
      {
        destinationCidrBlock:
          authority.providerSpec.capabilities.networking.egressCidr,
        internetGatewayId: id('network-internet-gateway'),
        routeTableId: id('network-route-table'),
      },
    );
    subnetAssociationId = syntheticProviderId(
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_DOMAIN,
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_PREFIX,
      {
        routeTableId: id('network-route-table'),
        subnetId: id('network-subnet'),
      },
    );
    runtimePolicyId = getAwsSingleNodeRuntimePolicyProviderResourceId({
      runtimeRoleId: id('runtime-role'),
    });
    runtimeAssociationId = getAwsSingleNodeRuntimeAssociationProviderResourceId(
      {
        runtimeRoleId: id('runtime-role'),
        instanceProfileId: id('runtime-identity'),
      },
    );
  } catch {
    throw new AwsSingleNodeNodeResourceConflictError();
  }
  if (
    id('artifact') !== artifactArn ||
    !VPC_ID_PATTERN.test(id('network-vpc') ?? '') ||
    !INTERNET_GATEWAY_ID_PATTERN.test(id('network-internet-gateway') ?? '') ||
    id('network-internet-gateway-attachment') !== internetGatewayAttachmentId ||
    !SUBNET_ID_PATTERN.test(id('network-subnet') ?? '') ||
    !ROUTE_TABLE_ID_PATTERN.test(id('network-route-table') ?? '') ||
    id('network-default-ipv4-route') !== defaultRouteId ||
    id('network-subnet-route-table-association') !== subnetAssociationId ||
    !SECURITY_GROUP_ID_PATTERN.test(id('network-security-group') ?? '') ||
    !AWS_IAM_ROLE_ID_PATTERN.test(id('runtime-role') ?? '') ||
    id('runtime-role-policy') !== runtimePolicyId ||
    !AWS_IAM_INSTANCE_PROFILE_ID_PATTERN.test(id('runtime-identity') ?? '') ||
    id('runtime-identity-role-association') !== runtimeAssociationId
  ) {
    throw new AwsSingleNodeNodeResourceConflictError();
  }
}

/** @param {string} key @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function expectedDependencyStateDigest(key, authority) {
  const nameAuthority = nodeNameAuthority(authority.plan);
  const policyAuthority = {
    providerScope: authority.plan.providerScope,
    deploymentInstanceId: authority.plan.deploymentInstanceId,
    incarnationId: authority.plan.incarnationId,
  };
  if (key === 'artifact') {
    return getAwsSingleNodeManagedArtifactStateDigest({
      deploymentRevision: authority.plan.deploymentRevision,
      profile: authority.profile,
      providerScope: authority.plan.providerScope,
      providerSpec: authority.providerSpec,
      deploymentInstanceId: authority.plan.deploymentInstanceId,
      incarnationId: authority.plan.incarnationId,
    });
  }
  if (key === 'network-subnet') {
    return getAwsSingleNodeSubnetStateDigest(authority.providerSpec);
  }
  if (key === 'network-vpc') {
    return getAwsSingleNodeVpcStateDigest(authority.providerSpec);
  }
  if (key === 'network-internet-gateway') {
    return getAwsSingleNodeInternetGatewayStateDigest(authority.providerSpec);
  }
  if (key === 'network-internet-gateway-attachment') {
    return getAwsSingleNodeInternetGatewayAttachmentStateDigest(
      authority.providerSpec,
    );
  }
  if (key === 'network-route-table') {
    return getAwsSingleNodeRouteTableStateDigest(authority.providerSpec);
  }
  if (key === 'network-default-ipv4-route') {
    return getAwsSingleNodeDefaultIpv4RouteStateDigest(authority.providerSpec);
  }
  if (key === 'network-subnet-route-table-association') {
    return getAwsSingleNodeSubnetRouteTableAssociationStateDigest(
      authority.providerSpec,
    );
  }
  if (key === 'network-security-group') {
    return getAwsSingleNodeSecurityGroupStateDigest(authority.providerSpec);
  }
  if (key === 'runtime-role-policy') {
    return getAwsSingleNodeRuntimePolicyStateDigest(policyAuthority);
  }
  if (key === 'runtime-role') {
    return getAwsSingleNodeRuntimeRoleStateDigest(nameAuthority);
  }
  if (key === 'runtime-identity') {
    return getAwsSingleNodeRuntimeInstanceProfileStateDigest(nameAuthority);
  }
  if (key === 'runtime-identity-role-association') {
    return getAwsSingleNodeRuntimeAssociationStateDigest(nameAuthority);
  }
  throw new AwsSingleNodeNodeResourceConflictError();
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function resolveDependencyAuthority(authority) {
  /** @type {Map<string, Readonly<Record<string, any>>>} */
  const bindings = new Map(
    authority.head.resourceBindings.map(
      (/** @type {Readonly<Record<string, any>>} */ binding) => [
        binding.resourceKey,
        binding,
      ],
    ),
  );
  /** @param {string} key @returns {Readonly<Record<string, any>>} */
  function requiredBinding(key) {
    const binding = bindings.get(key);
    if (binding === undefined) {
      throw new AwsSingleNodeNodeResourceConflictError();
    }
    return binding;
  }
  /** @param {string} key @returns {Readonly<Record<string, any>>} */
  function requiredDefinition(key) {
    const definition = getAwsSingleNodeResourceDefinition(key);
    if (definition === null) {
      throw new AwsSingleNodeNodeResourceConflictError();
    }
    return definition;
  }
  const validated = new Set();
  /** @param {string} key @returns {void} */
  function validateClosureBinding(key) {
    if (validated.has(key)) return;
    const definition = requiredDefinition(key);
    const binding = requiredBinding(key);
    for (const dependencyKey of definition.dependsOn) {
      validateClosureBinding(dependencyKey);
    }
    const expectedLineage = sortedBindingReceipts(
      definition.dependsOn.map((/** @type {string} */ dependencyKey) =>
        requiredBinding(dependencyKey),
      ),
    );
    if (
      binding.management !== 'managed' ||
      binding.deploymentInstanceId !== authority.plan.deploymentInstanceId ||
      binding.incarnationId !== authority.plan.incarnationId ||
      binding.providerScopeId !==
        authority.plan.providerScope.providerScopeId ||
      binding.resourceKey !== definition.resourceKey ||
      binding.providerType !== definition.providerType ||
      !sameJson(binding.capability, definition.capability) ||
      !sameJson(binding.role, definition.role) ||
      binding.ownershipMode !== definition.ownershipMode ||
      binding.onDestroy !== definition.onDestroy ||
      !sameDependencyBindings(binding.dependencyBindings, expectedLineage)
    ) {
      throw new AwsSingleNodeNodeResourceConflictError();
    }
    validated.add(key);
  }
  for (const key of DIRECT_DEPENDENCY_KEYS) validateClosureBinding(key);
  validateSpecificDependencyProviderIds(bindings, authority);

  for (const key of UPSTREAM_AUTHORITY_KEYS) {
    const definition = requiredDefinition(key);
    const binding = requiredBinding(key);
    const dependencyActionIndex = authority.plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ action) =>
        action.resourceKey === key,
    );
    const action = authority.plan.actions[dependencyActionIndex];
    const intent =
      authority.head.activeOperation.intents[dependencyActionIndex];
    const applyAuthority =
      authority.plan.operation !== 'destroy' &&
      dependencyActionIndex >= 0 &&
      dependencyActionIndex < authority.actionIndex &&
      intent?.status === 'settled' &&
      action?.after !== null &&
      action?.after !== undefined &&
      action.after.providerType === definition.providerType &&
      (action.after.providerResourceId === null ||
        action.after.providerResourceId === binding.providerResourceId);
    const destroyAuthority =
      authority.plan.operation === 'destroy' &&
      dependencyActionIndex > authority.actionIndex &&
      intent?.status === 'pending' &&
      action?.action === 'delete' &&
      action.before !== null &&
      action.before.providerType === definition.providerType &&
      action.before.providerResourceId === binding.providerResourceId;
    const stateDigest =
      authority.plan.operation === 'destroy'
        ? action?.before?.stateDigest
        : action?.after?.stateDigest;
    if (
      action === undefined ||
      intent === undefined ||
      (!applyAuthority && !destroyAuthority) ||
      intent.actionId !== action.actionId ||
      intent.ownershipNonce !== binding.ownershipNonce ||
      !sameJson(action.capability, definition.capability) ||
      !sameJson(action.role, definition.role) ||
      action.management !== 'managed' ||
      action.ownershipMode !== definition.ownershipMode ||
      action.onDestroy !== definition.onDestroy ||
      !sameJson(action.dependsOn, definition.dependsOn) ||
      !sameJson(stateDigest, expectedDependencyStateDigest(key, authority)) ||
      (action.action === 'create' &&
        binding.createdByActionId !== action.actionId)
    ) {
      throw new AwsSingleNodeNodeResourceConflictError();
    }
  }
  const directBindings = SORTED_DIRECT_DEPENDENCY_KEYS.map(
    (/** @type {string} */ key) => requiredBinding(key),
  );
  return deepFreeze({
    dependencyBindings: sortedBindingReceipts(directBindings),
    vpcId: requiredBinding('network-vpc').providerResourceId,
    subnetId: requiredBinding('network-subnet').providerResourceId,
    securityGroupId: requiredBinding('network-security-group')
      .providerResourceId,
    instanceProfileId: requiredBinding('runtime-identity').providerResourceId,
    instanceProfileName: getAwsSingleNodeRuntimeInstanceProfileName(
      nodeNameAuthority(authority.plan),
    ),
  });
}

/** @param {unknown} binding @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} dependencies @returns {boolean} */
function bindingMatchesAuthority(binding, authority, dependencies) {
  return (
    isPlainObject(binding) &&
    binding.management === 'managed' &&
    binding.providerType === PROVIDER_TYPE &&
    AWS_EC2_INSTANCE_ID_PATTERN.test(binding.providerResourceId) &&
    binding.deploymentInstanceId === authority.plan.deploymentInstanceId &&
    binding.incarnationId === authority.plan.incarnationId &&
    binding.resourceKey === RESOURCE_KEY &&
    binding.providerScopeId === authority.plan.providerScope.providerScopeId &&
    sameJson(binding.capability, authority.action.capability) &&
    sameJson(binding.role, authority.action.role) &&
    binding.ownershipMode === 'direct' &&
    binding.onDestroy === 'purge' &&
    sameDependencyBindings(
      binding.dependencyBindings,
      dependencies.dependencyBindings,
    ) &&
    binding.ownershipNonce === authority.ownershipNonce &&
    authority.action.before !== null &&
    authority.action.before.providerType === PROVIDER_TYPE &&
    authority.action.before.providerResourceId === binding.providerResourceId
  );
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>} */
function validateActionContext(value, providerScope) {
  if (!isPlainObject(value)) {
    throw new TypeError('awsSingleNodeNode action context must be an object.');
  }
  assertExactKeys(value, ACTION_CONTEXT_KEYS, 'awsSingleNodeNode context');
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeNode context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const providerSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeNode context.head',
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
    providerSpec.providerSpecId !== plan.providerSpec.providerSpecId ||
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
        /** @type {Readonly<Record<string, any>>} */ intent,
        /** @type {number} */ index,
      ) => intent.actionId !== plan.actions[index].actionId,
    )
  ) {
    throw new AwsSingleNodeNodeResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeNodeResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.resourceKey !== RESOURCE_KEY ||
    !sameJson(action.capability, { kind: 'resident-node', version: 1 }) ||
    !sameJson(action.role, { kind: 'node', version: 1 }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'purge' ||
    !sameJson(action.dependsOn, DIRECT_DEPENDENCY_KEYS)
  ) {
    throw new AwsSingleNodeNodeResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeNode context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeNodeResourceConflictError();
  }
  const stateDigest = getAwsSingleNodeNodeStateDigest(
    providerSpec,
    nodeNameAuthority(plan),
  );
  const partialAuthority = {
    operation: plan.operation,
    plan,
    action,
    actionIndex: value.actionIndex,
    ownershipNonce,
    head,
    profile,
    providerSpec,
    stateDigest,
  };
  const dependencies = resolveDependencyAuthority(partialAuthority);
  const priorBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === RESOURCE_KEY,
  );
  const authority = { ...partialAuthority, priorBinding: priorBinding ?? null };
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
      throw new AwsSingleNodeNodeResourceConflictError();
    }
  } else if (action.action === 'noop') {
    if (
      plan.operation === 'destroy' ||
      action.before === null ||
      action.after === null ||
      priorBinding === undefined ||
      !bindingMatchesAuthority(priorBinding, authority, dependencies) ||
      !sameJson(action.before.stateDigest, stateDigest) ||
      action.after.providerType !== PROVIDER_TYPE ||
      action.after.providerResourceId !== priorBinding.providerResourceId ||
      !sameJson(action.after.stateDigest, stateDigest)
    ) {
      throw new AwsSingleNodeNodeResourceConflictError();
    }
  } else if (action.action === 'delete') {
    if (
      plan.operation !== 'destroy' ||
      action.after !== null ||
      priorBinding === undefined ||
      !bindingMatchesAuthority(priorBinding, authority, dependencies) ||
      action.before.stateDigest === null
    ) {
      throw new AwsSingleNodeNodeResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeNodeResourceConflictError();
  }
  return deepFreeze({
    ...authority,
    priorBinding: priorBinding ?? null,
    ...dependencies,
    clientToken: getAwsSingleNodeNodeCreateClientToken(
      priorBinding?.createdByActionId ?? action.actionId,
      ownershipNonce,
    ),
    instanceProfileArn: `arn:${plan.providerScope.partition}:iam::${plan.providerScope.accountId}:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${dependencies.instanceProfileName}`,
  });
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {Readonly<import('@aws-sdk/client-ec2').RunInstancesCommandInput>} */
function runInstancesRequest(authority, recovery) {
  const spec = authority.providerSpec;
  const node = spec.node;
  const network = node.primaryNetworkInterface;
  const root = node.rootVolume;
  const instanceTags = recovery.requiredTags(authority);
  return deepFreeze({
    ImageId: spec.machineImage.imageId,
    InstanceType: node.instanceType,
    MinCount: 1,
    MaxCount: 1,
    ClientToken: authority.clientToken,
    Placement: {
      AvailabilityZoneId: spec.placement.availabilityZoneId,
      Tenancy: node.tenancy,
    },
    EbsOptimized: node.ebsOptimized,
    Monitoring: { Enabled: node.monitoring },
    CreditSpecification: { CpuCredits: node.cpuCredits },
    CapacityReservationSpecification: {
      CapacityReservationPreference: node.capacityReservationPreference,
    },
    HibernationOptions: { Configured: node.hibernation },
    EnclaveOptions: { Enabled: node.enclave },
    DisableApiStop: node.stopProtection,
    DisableApiTermination: node.terminationProtection,
    InstanceInitiatedShutdownBehavior: node.instanceInitiatedShutdownBehavior,
    MetadataOptions: {
      HttpEndpoint: node.metadataOptions.httpEndpoint,
      HttpTokens: node.metadataOptions.httpTokens,
      HttpPutResponseHopLimit: node.metadataOptions.httpPutResponseHopLimit,
      HttpProtocolIpv6: node.metadataOptions.httpProtocolIpv6,
      InstanceMetadataTags: node.metadataOptions.instanceMetadataTags,
    },
    PrivateDnsNameOptions: {
      HostnameType: node.privateDnsNameOptions.hostnameType,
      EnableResourceNameDnsARecord:
        node.privateDnsNameOptions.enableResourceNameDnsARecord,
      EnableResourceNameDnsAAAARecord:
        node.privateDnsNameOptions.enableResourceNameDnsAaaaRecord,
    },
    MaintenanceOptions: { AutoRecovery: node.maintenanceAutoRecovery },
    IamInstanceProfile: { Arn: authority.instanceProfileArn },
    NetworkInterfaces: [
      {
        DeviceIndex: network.deviceIndex,
        NetworkCardIndex: network.networkCardIndex,
        InterfaceType: network.interfaceType,
        Description: network.description,
        AssociatePublicIpAddress: network.associatePublicIpv4,
        DeleteOnTermination: network.deleteOnTermination,
        SubnetId: authority.subnetId,
        Groups: [authority.securityGroupId],
      },
    ],
    BlockDeviceMappings: [
      {
        DeviceName: root.deviceName,
        Ebs: {
          SnapshotId: root.snapshotId,
          VolumeType: root.volumeType,
          VolumeSize: root.sizeGiB,
          Iops: root.iops,
          Throughput: root.throughputMiBps,
          Encrypted: root.encrypted,
          KmsKeyId: spec.storage.ebsKmsKeyArn,
          DeleteOnTermination: root.deleteOnTermination,
        },
      },
    ],
    UserData: getAwsSingleNodeBootstrapBase64(),
    TagSpecifications: [
      {
        ResourceType: 'instance',
        Tags: recovery.sortedTags(instanceTags),
      },
      {
        ResourceType: 'volume',
        Tags: recovery.sortedTags(
          getAwsSingleNodeNodeRootVolumeTags(instanceTags),
        ),
      },
    ],
  });
}

/**
 * Bind one exact directly owned EC2 resident node. The factory owns neither
 * credentials nor client lifetime and exposes only controller action ports.
 * @param {unknown} options - Exact narrow client, provider scope, and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>}
 */
export function createAwsSingleNodeNodeResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('awsSingleNodeNode options must be an object.');
  }
  assertSupportedKeys(options, FACTORY_KEYS, 'awsSingleNodeNode options');
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeNode options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError('awsSingleNodeNode client must be an object.');
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(`awsSingleNodeNode client.${method} is required.`);
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeNode providerScope',
  );
  const maxAttempts =
    options.maxAttempts ?? AWS_SINGLE_NODE_NODE_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 2 ||
    maxAttempts > AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeNode maxAttempts must be an integer from 2 through ${AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError('awsSingleNodeNode waitForRetry must be a function.');
  }

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeNodeResourceUnknownError();
    }
  }

  /** @param {string} instanceId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeExactOnce(instanceId) {
    let response;
    try {
      response = await client.describeInstances(
        deepFreeze({ InstanceIds: [instanceId] }),
      );
    } catch (error) {
      if (instanceNotFound(error)) return null;
      throw new ProviderResponseUnknownError();
    }
    return decodeAwsSingleNodeNodeExactInstanceResponse(
      response,
      instanceId,
      providerScope,
    );
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<{records: Readonly<Record<string, any>>[], nextToken: string|null}>} */
  async function readDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeInstances(request);
    } catch {
      throw new ProviderResponseUnknownError();
    }
    return decodeAwsSingleNodeNodeInstancePage(response, providerScope, false);
  }

  const recovery = createAwsTaggedEc2RecoveryKernel({
    baseTags: AWS_SINGLE_NODE_NODE_BASE_INSTANCE_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS,
    idKey: 'InstanceId',
    idPattern: AWS_EC2_INSTANCE_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES,
    maxTags: AWS_SINGLE_NODE_NODE_MAX_TAGS,
    readDiscoveryPage,
    readExact: describeExactOnce,
  });

  /** @param {string} volumeId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeExactRootVolumeOnce(volumeId) {
    let response;
    try {
      response = await client.describeVolumes(
        deepFreeze({ VolumeIds: [volumeId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidVolume.NotFound')) return null;
      throw new ProviderResponseUnknownError();
    }
    return decodeAwsSingleNodeNodeExactRootVolumeResponse(response, volumeId);
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<{records: Readonly<Record<string, any>>[], nextToken: string|null}>} */
  async function readRootVolumeDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeVolumes(request);
    } catch {
      throw new ProviderResponseUnknownError();
    }
    return decodeAwsSingleNodeNodeRootVolumePage(response, false);
  }

  const rootRecovery = createAwsTaggedEc2RecoveryKernel({
    baseTags: AWS_SINGLE_NODE_NODE_BASE_ROOT_VOLUME_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_NODE_ROOT_DISCOVERY_MAX_RESULTS,
    idKey: 'VolumeId',
    idPattern: AWS_SINGLE_NODE_NODE_VOLUME_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES,
    maxTags: AWS_SINGLE_NODE_NODE_MAX_TAGS,
    readDiscoveryPage: readRootVolumeDiscoveryPage,
    readExact: describeExactRootVolumeOnce,
  });

  /** @param {Readonly<Record<string, any>>} authority @param {string|null} rootVolumeId @returns {Readonly<Record<string, any>>} */
  function rootVolumeRecoveryAuthority(authority, rootVolumeId) {
    return Object.freeze({
      ...authority,
      // Preserve the original create receipt for tags without letting the
      // generic kernel mistake the instance binding ID for a volume ID.
      priorBinding: Object.freeze({
        createdByActionId:
          authority.priorBinding?.createdByActionId ??
          authority.action.actionId,
        ...(rootVolumeId === null ? {} : { providerResourceId: rootVolumeId }),
      }),
    });
  }

  /** @param {Readonly<Record<string, any>>} authority @param {string|null} rootVolumeId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readRootVolumeIdentity(authority, rootVolumeId) {
    const rootAuthority = rootVolumeRecoveryAuthority(authority, rootVolumeId);
    const evidence = await rootRecovery.readIdentityEvidence(rootAuthority, {
      useDiscoveredId: true,
    });
    const expectedTags = rootRecovery.requiredTags(rootAuthority);
    if (evidence.discovered !== null) {
      validateAwsSingleNodeNodeManagedTags(
        evidence.discovered.Tags,
        expectedTags,
        false,
      );
    }
    if (evidence.exact !== null) {
      validateAwsSingleNodeNodeManagedTags(
        evidence.exact.Tags,
        expectedTags,
        false,
      );
    }
    if (evidence.exact === null) {
      if (evidence.discovered !== null) throw new NodeEvidenceTransientError();
      return null;
    }
    return evidence.exact;
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>|null} terminalInstance @returns {Promise<'logically-absent'|'exactly-absent'|'deleted'|'not-converged'>} */
  async function readRootVolumePurgeState(authority, terminalInstance) {
    const rootVolumeId =
      terminalInstance === null
        ? null
        : decodeAwsSingleNodeNodeTerminalRootVolumeId(
            terminalInstance.BlockDeviceMappings,
            authority.providerSpec.node.rootVolume.deviceName,
          );
    const volume = await readRootVolumeIdentity(authority, rootVolumeId);
    if (volume === null) {
      return rootVolumeId === null ? 'logically-absent' : 'exactly-absent';
    }
    return decodeAwsSingleNodeNodeRootVolumePurgeEvidence(volume, {
      providerSpec: authority.providerSpec,
      expectedTags: rootRecovery.requiredTags(
        rootVolumeRecoveryAuthority(authority, volume.VolumeId),
      ),
      instanceId: authority.priorBinding.providerResourceId,
    });
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readNodeIdentity(authority) {
    const evidence = await recovery.readIdentityEvidence(authority, {
      useDiscoveredId: true,
    });
    const allowTagPropagation = authority.action.action === 'create';
    if (evidence.discovered !== null) {
      decodeAwsSingleNodeNodeIdentityEvidence(evidence.discovered, {
        providerScopeAccountId: authority.plan.providerScope.accountId,
        expectedClientToken: authority.clientToken,
        expectedInstanceId: authority.priorBinding?.providerResourceId ?? null,
        expectedTags: recovery.requiredTags(authority),
        allowTagPropagation,
      });
    }
    if (evidence.exact !== null) {
      decodeAwsSingleNodeNodeIdentityEvidence(evidence.exact, {
        providerScopeAccountId: authority.plan.providerScope.accountId,
        expectedClientToken: authority.clientToken,
        expectedInstanceId: authority.priorBinding?.providerResourceId ?? null,
        expectedTags: recovery.requiredTags(authority),
        allowTagPropagation,
      });
    }
    if (evidence.exact === null) {
      if (evidence.discovered !== null) throw new NodeEvidenceTransientError();
      return null;
    }
    if (evidence.discovered === null && authority.action.action !== 'delete') {
      throw new NodeEvidenceTransientError();
    }
    return evidence.exact;
  }

  /** @param {string} instanceId @param {string} attribute @returns {Promise<unknown>} */
  async function readAttribute(instanceId, attribute) {
    try {
      return await client.describeInstanceAttribute(
        deepFreeze({ InstanceId: instanceId, Attribute: attribute }),
      );
    } catch (error) {
      if (instanceNotFound(error)) throw new NodeEvidenceTransientError();
      throw new ProviderResponseUnknownError();
    }
  }

  /** @param {Readonly<Record<string, any>>} instance @param {Readonly<Record<string, any>>} authority @param {'running'|'stopped'} state @returns {Promise<void>} */
  async function validateExactNode(instance, authority, state) {
    if (decodeAwsSingleNodeNodeLifecycle(instance.State) !== state) {
      throw new NodeEvidenceConflictError();
    }
    const { rootVolumeId, readableState: instanceState } =
      decodeAwsSingleNodeNodeInstanceState(instance, {
        providerSpec: authority.providerSpec,
        providerScopeAccountId: authority.plan.providerScope.accountId,
        vpcId: authority.vpcId,
        subnetId: authority.subnetId,
        securityGroupId: authority.securityGroupId,
        instanceProfileId: authority.instanceProfileId,
        instanceProfileArn: authority.instanceProfileArn,
      });
    const instanceId = instance.InstanceId;
    let responses;
    try {
      const observations = await Promise.allSettled([
        readAttribute(instanceId, 'userData'),
        readAttribute(instanceId, 'disableApiTermination'),
        readAttribute(instanceId, 'disableApiStop'),
        readAttribute(instanceId, 'instanceInitiatedShutdownBehavior'),
        Promise.resolve().then(() =>
          client.describeInstanceCreditSpecifications(
            deepFreeze({ InstanceIds: [instanceId] }),
          ),
        ),
        Promise.resolve().then(() =>
          client.describeVolumes(deepFreeze({ VolumeIds: [rootVolumeId] })),
        ),
      ]);
      for (const observation of observations) {
        if (observation.status === 'rejected') throw observation.reason;
      }
      responses = observations.map((observation) => {
        if (observation.status === 'rejected') throw observation.reason;
        return observation.value;
      });
    } catch (error) {
      if (
        error instanceof ProviderResponseUnknownError ||
        error instanceof NodeEvidenceTransientError
      ) {
        throw error;
      }
      if (instanceNotFound(error)) {
        throw new NodeEvidenceTransientError();
      }
      if (errorNamed(error, 'InvalidVolume.NotFound')) {
        if (authority.action.action === 'create') {
          throw new NodeEvidenceTransientError();
        }
        throw new NodeEvidenceConflictError();
      }
      throw new ProviderResponseUnknownError();
    }
    const attributes = {
      userData: decodeAwsSingleNodeNodeInstanceAttribute(
        responses[0],
        instanceId,
        'userData',
      ),
      disableApiTermination: decodeAwsSingleNodeNodeInstanceAttribute(
        responses[1],
        instanceId,
        'disableApiTermination',
      ),
      disableApiStop: decodeAwsSingleNodeNodeInstanceAttribute(
        responses[2],
        instanceId,
        'disableApiStop',
      ),
      instanceInitiatedShutdownBehavior:
        decodeAwsSingleNodeNodeInstanceAttribute(
          responses[3],
          instanceId,
          'instanceInitiatedShutdownBehavior',
        ),
    };
    const cpuCredits = decodeAwsSingleNodeNodeCreditSpecification(
      responses[4],
      instanceId,
    );
    const rootVolume = decodeAwsSingleNodeNodeExactRootVolumeResponse(
      responses[5],
      rootVolumeId,
    );
    const rootVolumeState = decodeAwsSingleNodeNodeRootVolumeState(rootVolume, {
      providerSpec: authority.providerSpec,
      expectedTags: getAwsSingleNodeNodeRootVolumeTags(
        recovery.requiredTags(authority),
      ),
      allowTagPropagation: authority.action.action === 'create',
      instanceId,
    });
    const observedDigest = getAwsSingleNodeNodeObservedStateDigest(
      authority.providerSpec,
      nodeNameAuthority(authority.plan),
      createAwsSingleNodeNodeReadableState(
        instanceState,
        attributes,
        cpuCredits,
        rootVolumeState,
      ),
    );
    if (!sameJson(observedDigest, authority.stateDigest)) {
      throw new NodeEvidenceConflictError();
    }
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    let instance;
    try {
      instance = await readNodeIdentity(authority);
    } catch (error) {
      if (error instanceof NodeEvidenceConflictError) {
        throw new AwsSingleNodeNodeResourceConflictError();
      }
      if (error instanceof NodeEvidenceTransientError) return;
      throw new AwsSingleNodeNodeResourceUnknownError();
    }
    if (authority.action.action === 'create' && instance === null) {
      recovery.claimCreateAttempt(authority);
      let response;
      try {
        response = await client.runInstances(
          runInstancesRequest(authority, recovery),
        );
      } catch (error) {
        if (errorNamed(error, 'IdempotentParameterMismatch')) {
          throw new AwsSingleNodeNodeResourceConflictError();
        }
        // The token makes an ambiguous launch replay-safe. Settlement first
        // attempts tagged recovery; a later execute may replay this request.
        return;
      }
      try {
        recovery.rememberCandidate(
          authority,
          decodeAwsSingleNodeNodeRunCandidateId(
            response,
            authority.clientToken,
            authority.plan.providerScope.accountId,
          ),
        );
      } catch (error) {
        if (error instanceof NodeEvidenceConflictError) {
          throw new AwsSingleNodeNodeResourceConflictError();
        }
        throw new AwsSingleNodeNodeResourceUnknownError();
      }
      return;
    }
    if (instance === null) return;
    let state;
    try {
      state = decodeAwsSingleNodeNodeLifecycle(instance.State);
    } catch (error) {
      if (error instanceof NodeEvidenceConflictError) {
        throw new AwsSingleNodeNodeResourceConflictError();
      }
      throw new AwsSingleNodeNodeResourceUnknownError();
    }
    if (
      authority.action.action === 'create' ||
      authority.action.action === 'noop'
    ) {
      if (state !== 'stopped') return;
      try {
        await validateExactNode(instance, authority, 'stopped');
      } catch (error) {
        if (error instanceof NodeEvidenceConflictError) {
          throw new AwsSingleNodeNodeResourceConflictError();
        }
        if (error instanceof NodeEvidenceTransientError) return;
        throw new AwsSingleNodeNodeResourceUnknownError();
      }
      try {
        await client.startInstances(
          deepFreeze({ InstanceIds: [instance.InstanceId] }),
        );
      } catch {
        // Starting an exact instance cannot duplicate it; settle by readback.
      }
      return;
    }
    if (state === 'terminated' || state === 'shutting-down') return;
    if (state === 'pending' || state === 'stopping') return;
    try {
      await validateExactNode(instance, authority, state);
    } catch (error) {
      if (error instanceof NodeEvidenceConflictError) {
        throw new AwsSingleNodeNodeResourceConflictError();
      }
      if (error instanceof NodeEvidenceTransientError) return;
      throw new AwsSingleNodeNodeResourceUnknownError();
    }
    try {
      await client.terminateInstances(
        deepFreeze({
          InstanceIds: [instance.InstanceId],
          SkipOsShutdown: false,
        }),
      );
    } catch (error) {
      if (errorNamed(error, 'OperationNotPermitted')) {
        // A deterministic refusal is permanent only if fresh readback still
        // shows the same nonterminal identity. A concurrent termination can
        // legitimately win the race before this error reaches the caller.
        let refreshed;
        try {
          refreshed = await readNodeIdentity(authority);
        } catch (readError) {
          if (readError instanceof NodeEvidenceConflictError) {
            throw new AwsSingleNodeNodeResourceConflictError();
          }
          if (readError instanceof NodeEvidenceTransientError) return;
          throw new AwsSingleNodeNodeResourceUnknownError();
        }
        if (refreshed === null) return;
        let refreshedState;
        try {
          refreshedState = decodeAwsSingleNodeNodeLifecycle(refreshed.State);
        } catch (readError) {
          if (readError instanceof NodeEvidenceConflictError) {
            throw new AwsSingleNodeNodeResourceConflictError();
          }
          throw new AwsSingleNodeNodeResourceUnknownError();
        }
        if (
          refreshedState === 'shutting-down' ||
          refreshedState === 'terminated'
        ) {
          return;
        }
        if (refreshedState !== state) return;
        throw new AwsSingleNodeNodeResourceConflictError();
      }
      // TerminateInstances is idempotent for the exact provider identity.
      // NotFound, IncorrectInstanceState, transport loss, and server failure
      // are all settled from the next exact read.
    }
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    const deleting = authority.action.action === 'delete';
    let jointAbsenceObservations = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const instance = await readNodeIdentity(authority);
        if (instance === null) {
          if (deleting) {
            const rootState = await readRootVolumePurgeState(authority, null);
            if (rootState === 'deleted') {
              recovery.clearCandidate(authority);
              return deepFreeze({ status: 'converged', binding: null });
            }
            if (rootState === 'logically-absent') {
              jointAbsenceObservations += 1;
              if (jointAbsenceObservations >= maxAttempts) {
                recovery.clearCandidate(authority);
                return deepFreeze({ status: 'converged', binding: null });
              }
            } else {
              jointAbsenceObservations = 0;
              throw new NodeEvidenceTransientError();
            }
          }
        } else {
          jointAbsenceObservations = 0;
          const state = decodeAwsSingleNodeNodeLifecycle(instance.State);
          if (deleting) {
            if (state === 'terminated') {
              const rootState = await readRootVolumePurgeState(
                authority,
                instance,
              );
              if (rootState !== 'not-converged') {
                recovery.clearCandidate(authority);
                return deepFreeze({ status: 'converged', binding: null });
              }
              throw new NodeEvidenceTransientError();
            }
          } else if (state === 'shutting-down' || state === 'terminated') {
            throw new NodeEvidenceConflictError();
          } else if (state === 'running') {
            await validateExactNode(instance, authority, 'running');
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
                ownershipMode: 'direct',
                onDestroy: 'purge',
                dependencyBindings: authority.dependencyBindings,
                providerType: PROVIDER_TYPE,
                providerResourceId: instance.InstanceId,
                providerScopeId: providerScope.providerScopeId,
                ownershipNonce: authority.ownershipNonce,
                createdByActionId: authority.action.actionId,
              });
            recovery.clearCandidate(authority);
            return deepFreeze({ status: 'converged', binding });
          } else if (state === 'stopped') {
            await validateExactNode(instance, authority, 'stopped');
            return Object.freeze({ status: 'not-converged' });
          } else if (attempt === maxAttempts) {
            return Object.freeze({ status: 'not-converged' });
          }
        }
      } catch (error) {
        jointAbsenceObservations = 0;
        if (error instanceof NodeEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof NodeEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeNodeResourceUnknownError();
          }
          return Object.freeze({ status: 'not-converged' });
        }
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
  AWS_SINGLE_NODE_NODE_CREATE_CLIENT_TOKEN_DOMAIN,
  AWS_SINGLE_NODE_NODE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_NODE_STATE_DIGEST_DOMAIN,
  AwsSingleNodeNodeResourceConflictError,
  AwsSingleNodeNodeResourceUnknownError,
  createAwsSingleNodeNodeResource,
  getAwsSingleNodeNodeCreateClientToken,
  getAwsSingleNodeNodeStateDigest,
};
