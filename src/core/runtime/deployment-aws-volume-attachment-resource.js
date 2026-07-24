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
import { getAwsSingleNodeNodeStateDigest } from './deployment-aws-node-resource.js';
import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import {
  AWS_EC2_INSTANCE_ID_PATTERN,
  AWS_IAM_INSTANCE_PROFILE_ID_PATTERN,
  AWS_IAM_ROLE_ID_PATTERN,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeAssociationStateDigest,
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
import { getAwsSingleNodeVolumeStateDigest } from './deployment-aws-volume-resource.js';
import { getAwsSingleNodeVpcStateDigest } from './deployment-aws-vpc-resource.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import { getAwsSingleNodeResourceDefinition } from './deployment-resource-graph.js';
import {
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DELETE_ON_TERMINATION,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_STATE_DIGEST_DOMAIN,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_VOLUME_ID_PATTERN as VOLUME_ID_PATTERN,
  AwsSingleNodeVolumeAttachmentEvidenceConflictError as AttachmentEvidenceConflictError,
  AwsSingleNodeVolumeAttachmentEvidenceTransientError as AttachmentEvidenceTransientError,
  AwsSingleNodeVolumeAttachmentEvidenceUnknownError as ProviderResponseUnknownError,
  decodeAwsSingleNodeVolumeAttachmentInstanceResponse,
  decodeAwsSingleNodeVolumeAttachmentVolumeResponse,
  getAwsSingleNodeVolumeAttachmentProviderResourceId,
  getAwsSingleNodeVolumeAttachmentStateDigest,
  getAwsSingleNodeVolumeAttachmentStrongestEvidenceError,
  reconcileAwsSingleNodeVolumeAttachmentViews,
} from './deployment-aws-volume-attachment-evidence.js';

export {
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DELETE_ON_TERMINATION,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_STATE_DIGEST_DOMAIN,
  getAwsSingleNodeVolumeAttachmentProviderResourceId,
  getAwsSingleNodeVolumeAttachmentStateDigest,
};

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
  'attachVolume',
  'describeInstances',
  'describeVolumes',
  'detachVolume',
  'modifyInstanceAttribute',
]);
const PROVIDER_TYPE = 'ebs-volume-attachment';
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,32}$/;
const SECURITY_GROUP_ID_PATTERN = /^sg-[0-9a-f]{8,32}$/;
const INTERNET_GATEWAY_ID_PATTERN = /^igw-[0-9a-f]{8,32}$/;
const ROUTE_TABLE_ID_PATTERN = /^rtb-[0-9a-f]{8,32}$/;
/** @type {Readonly<Record<string, Readonly<{resourceKey: string, capabilityKind: string, volumeResourceKey: string}>>>} */
const RESOURCE_CONTRACTS = Object.freeze({
  'application-state-attachment': Object.freeze({
    resourceKey: 'application-state-attachment',
    capabilityKind: 'application-state',
    volumeResourceKey: 'application-state',
  }),
  'control-state-attachment': Object.freeze({
    resourceKey: 'control-state-attachment',
    capabilityKind: 'control-state',
    volumeResourceKey: 'control-state',
  }),
});

/** Exact controller authority or provider evidence is contradictory. */
export class AwsSingleNodeVolumeAttachmentResourceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node volume attachment conflicts with its exact contract.',
    );
    this.name = 'AwsSingleNodeVolumeAttachmentResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_VOLUME_ATTACHMENT_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeVolumeAttachmentResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node volume attachment state is unknown.');
    this.name = 'AwsSingleNodeVolumeAttachmentResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_VOLUME_ATTACHMENT_RESOURCE_UNKNOWN';
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

/** @param {Readonly<Record<string, any>>} providerSpec @param {string} capabilityKind @returns {Readonly<Record<string, any>>} */
function attachmentConfiguration(providerSpec, capabilityKind) {
  if (capabilityKind === 'application-state') {
    return providerSpec.capabilities.applicationState;
  }
  if (capabilityKind === 'control-state') {
    return providerSpec.capabilities.controlState;
  }
  throw new TypeError(
    'AWS single-node volume attachment capability is not supported.',
  );
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
  if (key === 'application-state' || key === 'control-state') {
    return getAwsSingleNodeVolumeStateDigest(authority.providerSpec, key);
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
  if (key === 'network-subnet') {
    return getAwsSingleNodeSubnetStateDigest(authority.providerSpec);
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
  if (key === 'runtime-role') {
    return getAwsSingleNodeRuntimeRoleStateDigest(nameAuthority);
  }
  if (key === 'runtime-role-policy') {
    return getAwsSingleNodeRuntimePolicyStateDigest(policyAuthority);
  }
  if (key === 'runtime-identity') {
    return getAwsSingleNodeRuntimeInstanceProfileStateDigest(nameAuthority);
  }
  if (key === 'runtime-identity-role-association') {
    return getAwsSingleNodeRuntimeAssociationStateDigest(nameAuthority);
  }
  if (key === 'substrate') {
    return getAwsSingleNodeNodeStateDigest(
      authority.providerSpec,
      nameAuthority,
    );
  }
  throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
}

/** @param {Map<string, Readonly<Record<string, any>>>} bindings @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} contract @returns {void} */
function validateSpecificDependencyProviderIds(bindings, authority, contract) {
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
    throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
  }
  if (
    id('artifact') !== artifactArn ||
    !VOLUME_ID_PATTERN.test(id(contract.volumeResourceKey) ?? '') ||
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
    id('runtime-identity-role-association') !== runtimeAssociationId ||
    !AWS_EC2_INSTANCE_ID_PATTERN.test(id('substrate') ?? '')
  ) {
    throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} contract @returns {Readonly<Record<string, any>>} */
function resolveDependencyAuthority(authority, contract) {
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
      throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
    }
    return binding;
  }
  /** @param {string} key @returns {Readonly<Record<string, any>>} */
  function requiredDefinition(key) {
    const definition = getAwsSingleNodeResourceDefinition(key);
    if (definition === null) {
      throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
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
      throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
    }
    validated.add(key);
  }
  for (const key of [contract.volumeResourceKey, 'substrate']) {
    validateClosureBinding(key);
  }
  validateSpecificDependencyProviderIds(bindings, authority, contract);

  for (const key of validated) {
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
    const expectedDestroyAction =
      definition.onDestroy === 'retain' ? 'noop' : 'delete';
    const destroyAuthority =
      authority.plan.operation === 'destroy' &&
      dependencyActionIndex > authority.actionIndex &&
      intent?.status === 'pending' &&
      action?.action === expectedDestroyAction &&
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
      throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
    }
  }

  const volumeBinding = requiredBinding(contract.volumeResourceKey);
  const instanceBinding = requiredBinding('substrate');
  return deepFreeze({
    volumeBinding,
    instanceBinding,
    volumeId: volumeBinding.providerResourceId,
    instanceId: instanceBinding.providerResourceId,
    dependencyBindings: sortedBindingReceipts([volumeBinding, instanceBinding]),
  });
}

/** @param {unknown} binding @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} dependencies @returns {boolean} */
function bindingMatchesAuthority(binding, authority, dependencies) {
  return (
    isPlainObject(binding) &&
    binding.management === 'managed' &&
    binding.providerType === PROVIDER_TYPE &&
    binding.providerResourceId === authority.providerResourceId &&
    binding.deploymentInstanceId === authority.plan.deploymentInstanceId &&
    binding.incarnationId === authority.plan.incarnationId &&
    binding.resourceKey === authority.action.resourceKey &&
    binding.providerScopeId === authority.plan.providerScope.providerScopeId &&
    sameJson(binding.capability, authority.action.capability) &&
    sameJson(binding.role, authority.action.role) &&
    binding.ownershipMode === 'derived' &&
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
    throw new TypeError(
      'awsSingleNodeVolumeAttachment action context must be an object.',
    );
  }
  assertExactKeys(
    value,
    ACTION_CONTEXT_KEYS,
    'awsSingleNodeVolumeAttachment context',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeVolumeAttachment context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const providerSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeVolumeAttachment context.head',
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
    throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  const contract = RESOURCE_CONTRACTS[action.resourceKey];
  if (
    contract === undefined ||
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    !sameJson(action.capability, {
      kind: contract.capabilityKind,
      version: 1,
    }) ||
    !sameJson(action.role, { kind: 'attachment', version: 1 }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'derived' ||
    action.onDestroy !== 'purge' ||
    !sameJson(action.dependsOn, [contract.volumeResourceKey, 'substrate'])
  ) {
    throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeVolumeAttachment context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
  }
  const partialAuthority = {
    operation: plan.operation,
    plan,
    action,
    actionIndex: value.actionIndex,
    ownershipNonce,
    head,
    profile,
    providerSpec,
    contract,
  };
  const dependencies = resolveDependencyAuthority(partialAuthority, contract);
  const configuration = attachmentConfiguration(
    providerSpec,
    contract.capabilityKind,
  );
  const stateDigest = getAwsSingleNodeVolumeAttachmentStateDigest(
    providerSpec,
    contract.capabilityKind,
  );
  const providerResourceId = getAwsSingleNodeVolumeAttachmentProviderResourceId(
    providerSpec,
    contract.capabilityKind,
    dependencies.instanceId,
    dependencies.volumeId,
  );
  const priorBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === action.resourceKey,
  );
  const authority = {
    ...partialAuthority,
    ...dependencies,
    configuration,
    stateDigest,
    providerResourceId,
    priorBinding: priorBinding ?? null,
  };
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
      throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
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
      action.after.providerResourceId !== providerResourceId ||
      !sameJson(action.after.stateDigest, stateDigest)
    ) {
      throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
    }
  } else if (action.action === 'delete') {
    if (
      plan.operation !== 'destroy' ||
      action.after !== null ||
      priorBinding === undefined ||
      !bindingMatchesAuthority(priorBinding, authority, dependencies) ||
      !sameJson(action.before.stateDigest, stateDigest)
    ) {
      throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
  }
  return deepFreeze(authority);
}

/** @param {Readonly<Record<string, any>>} observed @param {Readonly<Record<string, any>>} expected @returns {void} */
function assertSameAuthority(observed, expected) {
  if (
    observed.plan.planId !== expected.plan.planId ||
    observed.action.actionId !== expected.action.actionId ||
    observed.actionIndex !== expected.actionIndex ||
    observed.head.generation !== expected.head.generation ||
    observed.ownershipNonce !== expected.ownershipNonce ||
    observed.instanceId !== expected.instanceId ||
    observed.volumeId !== expected.volumeId ||
    observed.providerResourceId !== expected.providerResourceId ||
    !sameJson(observed.stateDigest, expected.stateDigest) ||
    !sameDependencyBindings(
      observed.dependencyBindings,
      expected.dependencyBindings,
    )
  ) {
    throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
  }
}

/** @param {unknown} context @param {Readonly<Record<string, any>>} providerScope @param {Readonly<Record<string, any>>} expected @returns {Readonly<Record<string, any>>} */
function reproveActionContext(context, providerScope, expected) {
  let observed;
  try {
    observed = validateActionContext(context, providerScope);
  } catch {
    throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
  }
  assertSameAuthority(observed, expected);
  return observed;
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function evidenceOptions(authority) {
  return deepFreeze({
    providerScope: authority.plan.providerScope,
    availabilityZoneId: authority.providerSpec.placement.availabilityZoneId,
    instanceId: authority.instanceId,
    volumeId: authority.volumeId,
    deviceName: authority.configuration.deviceName,
  });
}

/** @param {unknown[]} errors @returns {void} */
function throwStrongestEvidenceError(errors) {
  const authorityError = errors.find(
    (error) =>
      error instanceof AwsSingleNodeVolumeAttachmentResourceConflictError,
  );
  if (authorityError !== undefined) throw authorityError;
  const strongest =
    getAwsSingleNodeVolumeAttachmentStrongestEvidenceError(errors);
  if (strongest !== null) throw strongest;
}

/**
 * Bind one exact dependency-derived retained EBS relationship. The caller
 * owns the narrow EC2 client. V43 does not mount these volumes in the guest;
 * adding guest use requires an explicit quiesce/unmount effect before delete.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>}
 */
export function createAwsSingleNodeVolumeAttachmentResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeVolumeAttachment options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeVolumeAttachment options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeVolumeAttachment options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError(
      'awsSingleNodeVolumeAttachment client must be an object.',
    );
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeVolumeAttachment client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeVolumeAttachment providerScope',
  );
  const maxAttempts =
    options.maxAttempts ??
    AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 2 ||
    maxAttempts > AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeVolumeAttachment maxAttempts must be an integer from 2 through ${AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeVolumeAttachment waitForRetry must be a function.',
    );
  }

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeVolumeAttachmentResourceUnknownError();
    }
  }

  /** @param {unknown} context @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeInstanceOnce(context, authority) {
    const current = reproveActionContext(context, providerScope, authority);
    let response;
    try {
      response = await client.describeInstances(
        deepFreeze({ InstanceIds: [current.instanceId] }),
      );
    } catch (error) {
      if (instanceNotFound(error)) return null;
      throw new ProviderResponseUnknownError();
    }
    return decodeAwsSingleNodeVolumeAttachmentInstanceResponse(
      response,
      evidenceOptions(current),
    );
  }

  /** @param {unknown} context @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeVolumeOnce(context, authority) {
    const current = reproveActionContext(context, providerScope, authority);
    let response;
    try {
      response = await client.describeVolumes(
        deepFreeze({ VolumeIds: [current.volumeId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidVolume.NotFound')) return null;
      throw new ProviderResponseUnknownError();
    }
    return decodeAwsSingleNodeVolumeAttachmentVolumeResponse(
      response,
      evidenceOptions(current),
    );
  }

  /** @param {unknown} context @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>>} */
  async function readLogicalState(context, authority) {
    const [instanceResult, volumeResult] = await Promise.allSettled([
      describeInstanceOnce(context, authority),
      describeVolumeOnce(context, authority),
    ]);
    const errors = [];
    if (instanceResult.status === 'rejected') {
      errors.push(instanceResult.reason);
    }
    if (volumeResult.status === 'rejected') errors.push(volumeResult.reason);
    throwStrongestEvidenceError(errors);
    if (
      instanceResult.status !== 'fulfilled' ||
      volumeResult.status !== 'fulfilled'
    ) {
      throw new ProviderResponseUnknownError();
    }
    return reconcileAwsSingleNodeVolumeAttachmentViews({
      action: authority.action.action,
      instanceView: instanceResult.value,
      volumeView: volumeResult.value,
    });
  }

  /** @param {unknown} context @param {Readonly<Record<string, any>>} authority @returns {Promise<void>} */
  async function modifyRetention(context, authority) {
    const current = reproveActionContext(context, providerScope, authority);
    try {
      await client.modifyInstanceAttribute(
        deepFreeze({
          InstanceId: current.instanceId,
          Attribute: 'blockDeviceMapping',
          BlockDeviceMappings: [
            {
              DeviceName: current.configuration.deviceName,
              Ebs: {
                VolumeId: current.volumeId,
                DeleteOnTermination:
                  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DELETE_ON_TERMINATION,
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (
        errorNamed(error, 'InvalidInstanceAttributeValue') ||
        errorNamed(error, 'UnsupportedOperation') ||
        errorNamed(error, 'UnsupportedOperationException')
      ) {
        throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
      }
      // A response cannot settle this effect. Exact dual readback decides.
    }
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    let logical;
    try {
      logical = await readLogicalState(value, authority);
    } catch (error) {
      if (error instanceof AttachmentEvidenceConflictError) {
        throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
      }
      if (error instanceof AttachmentEvidenceTransientError) return;
      if (error instanceof AwsSingleNodeVolumeAttachmentResourceConflictError) {
        throw error;
      }
      throw new AwsSingleNodeVolumeAttachmentResourceUnknownError();
    }

    if (authority.action.action === 'delete') {
      if (logical.state === 'absent' || logical.state === 'endpoint-absent') {
        return;
      }
      if (logical.state === 'needs-retention') {
        await modifyRetention(value, authority);
        return;
      }
      if (logical.state !== 'attached') return;
      const current = reproveActionContext(value, providerScope, authority);
      try {
        await client.detachVolume(
          deepFreeze({
            Device: current.configuration.deviceName,
            Force: false,
            InstanceId: current.instanceId,
            VolumeId: current.volumeId,
          }),
        );
      } catch (error) {
        if (
          errorNamed(error, 'UnsupportedOperation') ||
          errorNamed(error, 'UnsupportedOperationException')
        ) {
          throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
        }
        // Detach is never forced and only exact dual readback settles absence.
      }
      return;
    }

    if (logical.state === 'needs-retention') {
      await modifyRetention(value, authority);
      return;
    }
    if (logical.state !== 'absent' || authority.action.action === 'noop') {
      return;
    }
    const current = reproveActionContext(value, providerScope, authority);
    try {
      await client.attachVolume(
        deepFreeze({
          Device: current.configuration.deviceName,
          EbsCardIndex: AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
          InstanceId: current.instanceId,
          VolumeId: current.volumeId,
        }),
      );
    } catch (error) {
      if (
        errorNamed(error, 'UnsupportedOperation') ||
        errorNamed(error, 'UnsupportedOperationException') ||
        errorNamed(error, 'InvalidVolume.ZoneMismatch')
      ) {
        throw new AwsSingleNodeVolumeAttachmentResourceConflictError();
      }
      // VolumeInUse, IncorrectState, NotFound, and transport loss can all race
      // an exact attach; the provider response is never settlement evidence.
    }
    // Attachment propagation must be independently visible through both EC2
    // projections before a later execute may normalize retention behavior.
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    let endpointAbsenceSignature = null;
    let endpointAbsenceObservations = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const logical = await readLogicalState(value, authority);
        if (logical.state === 'endpoint-absent') {
          if (authority.action.action !== 'delete') {
            return Object.freeze({ status: 'blocked' });
          }
          if (logical.signature === endpointAbsenceSignature) {
            endpointAbsenceObservations += 1;
          } else {
            endpointAbsenceSignature = logical.signature;
            endpointAbsenceObservations = 1;
          }
          if (endpointAbsenceObservations === maxAttempts) {
            return deepFreeze({ status: 'converged', binding: null });
          }
        } else {
          endpointAbsenceSignature = null;
          endpointAbsenceObservations = 0;
        }
        if (logical.state === 'absent') {
          if (authority.action.action === 'delete') {
            return deepFreeze({ status: 'converged', binding: null });
          }
          if (authority.action.action === 'noop') {
            // Recreating a relationship that disappeared after durable
            // settlement is not authorized by the controller's noop intent.
            return Object.freeze({ status: 'blocked' });
          }
        } else if (logical.state === 'attached') {
          if (authority.action.action === 'delete') {
            // Exact retained presence is not settlement for delete. V43 never
            // mounts these devices; a future mount effect must quiesce first.
          } else {
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
        }
      } catch (error) {
        endpointAbsenceSignature = null;
        endpointAbsenceObservations = 0;
        if (error instanceof AttachmentEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          error instanceof AwsSingleNodeVolumeAttachmentResourceConflictError
        ) {
          throw error;
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof AttachmentEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeVolumeAttachmentResourceUnknownError();
          }
          return Object.freeze({ status: 'not-converged' });
        }
        await wait(attempt);
        continue;
      }
      if (attempt < maxAttempts) await wait(attempt);
    }
    return Object.freeze({ status: 'not-converged' });
  }

  return Object.freeze({ executeAction, verifySettlement });
}

export default {
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DELETE_ON_TERMINATION,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_STATE_DIGEST_DOMAIN,
  AwsSingleNodeVolumeAttachmentResourceConflictError,
  AwsSingleNodeVolumeAttachmentResourceUnknownError,
  createAwsSingleNodeVolumeAttachmentResource,
  getAwsSingleNodeVolumeAttachmentProviderResourceId,
  getAwsSingleNodeVolumeAttachmentStateDigest,
};
