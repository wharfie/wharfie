/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider contracts are clearer than parser-specific expansions. */

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
import { getAwsSingleNodeManagedArtifactStateDigest } from './deployment-aws-managed-artifact-resource.js';
import { getAwsSingleNodeNodeStateDigest } from './deployment-aws-node-resource.js';
import {
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
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

export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX = 0;
export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DELETE_ON_TERMINATION = false;
export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ebs-volume-attachment-state:v1';
export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN =
  'wharfie:aws-single-node-ebs-volume-attachment:v1';
export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX =
  'wva1';

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
const VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/;
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,32}$/;
const SECURITY_GROUP_ID_PATTERN = /^sg-[0-9a-f]{8,32}$/;
const INTERNET_GATEWAY_ID_PATTERN = /^igw-[0-9a-f]{8,32}$/;
const ROUTE_TABLE_ID_PATTERN = /^rtb-[0-9a-f]{8,32}$/;
const DEVICE_NAME_PATTERN = /^\/dev\/(?:xvd|sd)[a-z](?:[1-9][0-9]*)?$/;
/** @type {Readonly<Record<string, number>>} */
const INSTANCE_STATES = Object.freeze({
  pending: 0,
  running: 16,
  'shutting-down': 32,
  terminated: 48,
  stopping: 64,
  stopped: 80,
});
const ATTACHMENT_STATES = new Set([
  'attaching',
  'attached',
  'detaching',
  'detached',
  'busy',
]);
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

class ProviderResponseUnknownError extends Error {}
class AttachmentEvidenceConflictError extends Error {}
class AttachmentEvidenceTransientError extends Error {}

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

/** @param {unknown} providerSpecValue @param {unknown} capabilityKindValue @returns {Readonly<Record<string, any>>} */
function attachmentStateDescriptor(providerSpecValue, capabilityKindValue) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    providerSpecValue,
    'awsSingleNodeVolumeAttachment providerSpec',
  );
  if (typeof capabilityKindValue !== 'string') {
    throw new TypeError(
      'awsSingleNodeVolumeAttachment capabilityKind must be a string.',
    );
  }
  const configuration = attachmentConfiguration(
    providerSpec,
    capabilityKindValue,
  );
  return deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: 1,
      kind: 'awsSingleNodeEbsVolumeAttachmentState',
      capability: { kind: capabilityKindValue, version: 1 },
      role: { kind: 'attachment', version: 1 },
      deviceName: configuration.deviceName,
      attachmentState: 'attached',
      ebsCardIndex: AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
      deleteOnTermination:
        AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DELETE_ON_TERMINATION,
      onDestroy: 'purge',
    }),
  );
}

/**
 * Derive plan-time retained attachment state without provider-allocated IDs.
 * @param {unknown} providerSpec - Exact AWS single-node provider specification.
 * @param {unknown} capabilityKind - Application or control state capability.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function getAwsSingleNodeVolumeAttachmentStateDigest(
  providerSpec,
  capabilityKind,
) {
  const descriptor = attachmentStateDescriptor(providerSpec, capabilityKind);
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_VOLUME_ATTACHMENT_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/**
 * Derive the provider-independent identity of one exact EBS relationship.
 * @param {unknown} providerSpec - Exact AWS single-node provider specification.
 * @param {unknown} capabilityKind - Application or control state capability.
 * @param {unknown} instanceId - Exact settled substrate instance ID.
 * @param {unknown} volumeId - Exact settled retained volume ID.
 * @returns {string}
 */
export function getAwsSingleNodeVolumeAttachmentProviderResourceId(
  providerSpec,
  capabilityKind,
  instanceId,
  volumeId,
) {
  const state = attachmentStateDescriptor(providerSpec, capabilityKind);
  if (
    typeof instanceId !== 'string' ||
    !AWS_EC2_INSTANCE_ID_PATTERN.test(instanceId)
  ) {
    throw new TypeError(
      'awsSingleNodeVolumeAttachment instanceId must be a canonical EC2 instance ID.',
    );
  }
  if (typeof volumeId !== 'string' || !VOLUME_ID_PATTERN.test(volumeId)) {
    throw new TypeError(
      'awsSingleNodeVolumeAttachment volumeId must be a canonical EBS volume ID.',
    );
  }
  return createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
    value: sortCanonicalJsonValue({
      ...state,
      instanceId,
      volumeId,
    }),
    valuePath: 'awsSingleNodeVolumeAttachment provider identity',
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

/** @param {unknown} value @returns {string} */
function validateInstanceState(value) {
  if (
    !isPlainObject(value) ||
    typeof value.Name !== 'string' ||
    !Number.isSafeInteger(value.Code) ||
    value.Code < 0
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    !Object.hasOwn(INSTANCE_STATES, value.Name) ||
    (value.Code & 0xff) !== INSTANCE_STATES[value.Name]
  ) {
    throw new AttachmentEvidenceConflictError();
  }
  return value.Name;
}

/** @param {unknown} value @returns {boolean} */
function absent(value) {
  return value === undefined || value === null;
}

/** @param {unknown} value @param {string} expectedVolumeId @returns {{deviceName: string, volumeId: string, state: string, deleteOnTermination: boolean|null, ebsCardIndex: number, intendedVolume: boolean}} */
function decodeInstanceMapping(value, expectedVolumeId) {
  if (
    !isPlainObject(value) ||
    typeof value.DeviceName !== 'string' ||
    !DEVICE_NAME_PATTERN.test(value.DeviceName) ||
    !isPlainObject(value.Ebs) ||
    typeof value.Ebs.VolumeId !== 'string' ||
    !VOLUME_ID_PATTERN.test(value.Ebs.VolumeId) ||
    typeof value.Ebs.Status !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (!ATTACHMENT_STATES.has(value.Ebs.Status)) {
    throw new AttachmentEvidenceConflictError();
  }
  if (
    !absent(value.Ebs.AssociatedResource) ||
    !absent(value.Ebs.VolumeOwnerId) ||
    (value.Ebs.EbsCardIndex !== undefined &&
      value.Ebs.EbsCardIndex !==
        AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX)
  ) {
    throw new AttachmentEvidenceConflictError();
  }
  if (
    value.Ebs.DeleteOnTermination !== undefined &&
    typeof value.Ebs.DeleteOnTermination !== 'boolean'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (value.Ebs.Operator !== undefined && value.Ebs.Operator !== null) {
    if (
      !isPlainObject(value.Ebs.Operator) ||
      typeof value.Ebs.Operator.Managed !== 'boolean'
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (value.Ebs.Operator.Managed || !absent(value.Ebs.Operator.Principal)) {
      throw new AttachmentEvidenceConflictError();
    }
  }
  return {
    deviceName: value.DeviceName,
    volumeId: value.Ebs.VolumeId,
    state: value.Ebs.Status,
    deleteOnTermination: value.Ebs.DeleteOnTermination ?? null,
    ebsCardIndex:
      value.Ebs.EbsCardIndex ??
      AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
    intendedVolume: value.Ebs.VolumeId === expectedVolumeId,
  };
}

/** @param {unknown} response @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function oneInstanceFromResponse(response, authority) {
  if (!isPlainObject(response) || !Array.isArray(response.Reservations)) {
    throw new ProviderResponseUnknownError();
  }
  if (!absent(response.NextToken)) {
    throw new AttachmentEvidenceConflictError();
  }
  if (response.Reservations.length === 0) {
    throw new ProviderResponseUnknownError();
  }
  if (response.Reservations.length !== 1) {
    throw new AttachmentEvidenceConflictError();
  }
  const reservation = response.Reservations[0];
  if (
    !isPlainObject(reservation) ||
    typeof reservation.OwnerId !== 'string' ||
    !Array.isArray(reservation.Instances)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (reservation.OwnerId !== authority.plan.providerScope.accountId) {
    throw new AttachmentEvidenceConflictError();
  }
  if (reservation.Instances.length === 0) {
    throw new ProviderResponseUnknownError();
  }
  if (
    reservation.Instances.length !== 1 ||
    !isPlainObject(reservation.Instances[0])
  ) {
    throw new AttachmentEvidenceConflictError();
  }
  const instance = reservation.Instances[0];
  if (
    typeof instance.InstanceId !== 'string' ||
    !AWS_EC2_INSTANCE_ID_PATTERN.test(instance.InstanceId) ||
    !isPlainObject(instance.Placement) ||
    typeof instance.Placement.AvailabilityZoneId !== 'string' ||
    !Array.isArray(instance.BlockDeviceMappings)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    instance.InstanceId !== authority.instanceId ||
    instance.Placement.AvailabilityZoneId !==
      authority.providerSpec.placement.availabilityZoneId
  ) {
    throw new AttachmentEvidenceConflictError();
  }
  const state = validateInstanceState(instance.State);
  const deviceNames = new Set();
  const volumeIds = new Set();
  let intended = null;
  for (const candidate of instance.BlockDeviceMappings) {
    const mapping = decodeInstanceMapping(candidate, authority.volumeId);
    if (
      deviceNames.has(mapping.deviceName) ||
      volumeIds.has(mapping.volumeId)
    ) {
      throw new AttachmentEvidenceConflictError();
    }
    deviceNames.add(mapping.deviceName);
    volumeIds.add(mapping.volumeId);
    if (
      mapping.deviceName === authority.configuration.deviceName ||
      mapping.intendedVolume
    ) {
      if (
        mapping.deviceName !== authority.configuration.deviceName ||
        !mapping.intendedVolume ||
        intended !== null
      ) {
        throw new AttachmentEvidenceConflictError();
      }
      intended = mapping;
    }
  }
  return deepFreeze({ instance, state, attachment: intended });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function decodeVolumeAttachment(value, authority) {
  if (
    !isPlainObject(value) ||
    typeof value.VolumeId !== 'string' ||
    !VOLUME_ID_PATTERN.test(value.VolumeId) ||
    typeof value.InstanceId !== 'string' ||
    !AWS_EC2_INSTANCE_ID_PATTERN.test(value.InstanceId) ||
    typeof value.Device !== 'string' ||
    !DEVICE_NAME_PATTERN.test(value.Device) ||
    typeof value.State !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (!ATTACHMENT_STATES.has(value.State)) {
    throw new AttachmentEvidenceConflictError();
  }
  if (
    value.VolumeId !== authority.volumeId ||
    value.InstanceId !== authority.instanceId ||
    value.Device !== authority.configuration.deviceName ||
    !absent(value.AssociatedResource) ||
    !absent(value.InstanceOwningService) ||
    (value.EbsCardIndex !== undefined &&
      value.EbsCardIndex !== AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX)
  ) {
    throw new AttachmentEvidenceConflictError();
  }
  if (
    value.DeleteOnTermination !== undefined &&
    typeof value.DeleteOnTermination !== 'boolean'
  ) {
    throw new ProviderResponseUnknownError();
  }
  return deepFreeze({
    state: value.State,
    deleteOnTermination: value.DeleteOnTermination ?? null,
    ebsCardIndex:
      value.EbsCardIndex ?? AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
  });
}

/** @param {unknown} response @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function oneVolumeFromResponse(response, authority) {
  if (!isPlainObject(response) || !Array.isArray(response.Volumes)) {
    throw new ProviderResponseUnknownError();
  }
  if (!absent(response.NextToken)) {
    throw new AttachmentEvidenceConflictError();
  }
  if (response.Volumes.length === 0) throw new ProviderResponseUnknownError();
  if (response.Volumes.length !== 1 || !isPlainObject(response.Volumes[0])) {
    throw new AttachmentEvidenceConflictError();
  }
  const volume = response.Volumes[0];
  if (
    typeof volume.VolumeId !== 'string' ||
    !VOLUME_ID_PATTERN.test(volume.VolumeId) ||
    typeof volume.AvailabilityZoneId !== 'string' ||
    typeof volume.State !== 'string' ||
    typeof volume.MultiAttachEnabled !== 'boolean' ||
    !Array.isArray(volume.Attachments)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    volume.VolumeId !== authority.volumeId ||
    volume.AvailabilityZoneId !==
      authority.providerSpec.placement.availabilityZoneId ||
    volume.MultiAttachEnabled !== false
  ) {
    throw new AttachmentEvidenceConflictError();
  }
  if (
    volume.Operator !== undefined &&
    volume.Operator !== null &&
    (!isPlainObject(volume.Operator) ||
      volume.Operator.Managed !== false ||
      !absent(volume.Operator.Principal))
  ) {
    throw new AttachmentEvidenceConflictError();
  }
  if (
    ![
      'creating',
      'available',
      'in-use',
      'deleting',
      'deleted',
      'error',
    ].includes(volume.State)
  ) {
    throw new AttachmentEvidenceConflictError();
  }
  if (volume.Attachments.length > 1) {
    throw new AttachmentEvidenceConflictError();
  }
  const attachment =
    volume.Attachments.length === 0
      ? null
      : decodeVolumeAttachment(volume.Attachments[0], authority);
  return deepFreeze({ volume, state: volume.State, attachment });
}

/** @param {Readonly<Record<string, any>>|null} instanceView @param {Readonly<Record<string, any>>|null} volumeView @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function logicalStateFromViews(instanceView, volumeView, authority) {
  if (instanceView === null || volumeView === null) {
    const remainingAttachment =
      instanceView?.attachment ?? volumeView?.attachment ?? null;
    if (authority.action.action !== 'delete') {
      throw new AttachmentEvidenceConflictError();
    }
    if (remainingAttachment !== null) {
      throw new AttachmentEvidenceTransientError();
    }
    return deepFreeze({
      state: 'endpoint-absent',
      signature:
        instanceView === null && volumeView === null
          ? 'instance-and-volume'
          : instanceView === null
            ? 'instance'
            : 'volume',
    });
  }
  if (authority.action.action !== 'delete') {
    if (instanceView.state === 'pending' || instanceView.state === 'stopping') {
      throw new AttachmentEvidenceTransientError();
    }
    if (
      instanceView.state === 'shutting-down' ||
      instanceView.state === 'terminated'
    ) {
      throw new AttachmentEvidenceConflictError();
    }
    if (volumeView.state === 'deleting' || volumeView.state === 'deleted') {
      throw new AttachmentEvidenceConflictError();
    }
  }
  if (volumeView.state === 'error') {
    throw new AttachmentEvidenceConflictError();
  }
  const instanceAttachment = instanceView.attachment;
  const volumeAttachment = volumeView.attachment;
  if (instanceAttachment === null && volumeAttachment === null) {
    if (volumeView.state === 'creating' || volumeView.state === 'in-use') {
      throw new AttachmentEvidenceTransientError();
    }
    if (volumeView.state !== 'available') {
      if (
        authority.action.action === 'delete' &&
        (volumeView.state === 'deleting' || volumeView.state === 'deleted')
      ) {
        return deepFreeze({ state: 'absent' });
      }
      throw new AttachmentEvidenceConflictError();
    }
    return deepFreeze({ state: 'absent', instanceState: instanceView.state });
  }
  if (instanceAttachment === null || volumeAttachment === null) {
    const observed = instanceAttachment ?? volumeAttachment;
    if (
      observed.state === 'attaching' ||
      observed.state === 'detaching' ||
      observed.state === 'detached' ||
      instanceView.state === 'pending' ||
      instanceView.state === 'stopping' ||
      instanceView.state === 'shutting-down'
    ) {
      throw new AttachmentEvidenceTransientError();
    }
    // Either EC2 projection can reach its stable label before the other
    // projection publishes or removes the exact same intended row.
    throw new AttachmentEvidenceTransientError();
  }
  if (
    instanceAttachment.ebsCardIndex !==
      AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX ||
    volumeAttachment.ebsCardIndex !==
      AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX
  ) {
    throw new AttachmentEvidenceConflictError();
  }
  if (
    instanceAttachment.state === 'busy' ||
    volumeAttachment.state === 'busy'
  ) {
    throw new AttachmentEvidenceTransientError();
  }
  if (
    instanceAttachment.state !== 'attached' ||
    volumeAttachment.state !== 'attached' ||
    volumeView.state !== 'in-use' ||
    instanceView.state === 'pending' ||
    instanceView.state === 'stopping' ||
    instanceView.state === 'shutting-down'
  ) {
    throw new AttachmentEvidenceTransientError();
  }
  if (instanceView.state === 'terminated') {
    throw new AttachmentEvidenceTransientError();
  }
  return deepFreeze({
    state:
      instanceAttachment.deleteOnTermination === false &&
      volumeAttachment.deleteOnTermination === false
        ? 'attached'
        : 'needs-retention',
    instanceState: instanceView.state,
  });
}

/** @param {unknown[]} errors @returns {void} */
function throwStrongestEvidenceError(errors) {
  const authorityError = errors.find(
    (error) =>
      error instanceof AwsSingleNodeVolumeAttachmentResourceConflictError,
  );
  if (authorityError !== undefined) throw authorityError;
  if (
    errors.some((error) => error instanceof AttachmentEvidenceConflictError)
  ) {
    throw new AttachmentEvidenceConflictError();
  }
  if (errors.some((error) => error instanceof ProviderResponseUnknownError)) {
    throw new ProviderResponseUnknownError();
  }
  if (
    errors.some((error) => error instanceof AttachmentEvidenceTransientError)
  ) {
    throw new AttachmentEvidenceTransientError();
  }
  if (errors.length > 0) throw new ProviderResponseUnknownError();
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
    return oneInstanceFromResponse(response, current);
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
    return oneVolumeFromResponse(response, current);
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
    return logicalStateFromViews(
      instanceResult.value,
      volumeResult.value,
      authority,
    );
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
