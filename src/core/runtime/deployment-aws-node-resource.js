/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider contracts are clearer than parser-specific expansions. */

import { isIPv4 } from 'node:net';

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from './content-id.js';
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
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
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
  DEPLOYMENT_ACTION_ID_PREFIX,
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import { getAwsSingleNodeResourceDefinition } from './deployment-resource-graph.js';
import { getAwsSingleNodeVpcStateDigest } from './deployment-aws-vpc-resource.js';

export const AWS_SINGLE_NODE_NODE_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS = 1000;
export const AWS_SINGLE_NODE_NODE_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-instance-state:v1';
export const AWS_SINGLE_NODE_NODE_CREATE_CLIENT_TOKEN_DOMAIN =
  'wharfie:aws-single-node-ec2-instance-create-client-token:v1';

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
const NAME_AUTHORITY_KEYS = new Set([
  'providerScopeId',
  'deploymentInstanceId',
  'incarnationId',
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
const MAX_INSTANCE_TAGS = 50;
const ROOT_VOLUME_DISCOVERY_MAX_RESULTS = 500;
const VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/;
const NETWORK_INTERFACE_ID_PATTERN = /^eni-[0-9a-f]{8,32}$/;
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,32}$/;
const SECURITY_GROUP_ID_PATTERN = /^sg-[0-9a-f]{8,32}$/;
const INTERNET_GATEWAY_ID_PATTERN = /^igw-[0-9a-f]{8,32}$/;
const ROUTE_TABLE_ID_PATTERN = /^rtb-[0-9a-f]{8,32}$/;
/** @type {Readonly<Record<string, number>>} */
const INSTANCE_STATES = Object.freeze({
  pending: 0,
  running: 16,
  'shutting-down': 32,
  terminated: 48,
  stopping: 64,
  stopped: 80,
});
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
const BASE_INSTANCE_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-substrate',
  'wharfie:retention': 'purge',
  'wharfie:schema-version': '2',
});
const BASE_ROOT_VOLUME_TAGS = Object.freeze({
  ...BASE_INSTANCE_TAGS,
  'wharfie:resource-kind': 'single-node-substrate-root-volume',
});

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

/**
 * Derive exact intrinsic launch state. Provider-allocated subnet, security
 * group, profile, instance, ENI, and volume IDs live in binding lineage or
 * provider evidence. The deterministic profile name is launch intent.
 * @param {unknown} value - Exact provider specification.
 * @param {unknown} nameAuthority - Exact deterministic runtime-name authority.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function getAwsSingleNodeNodeStateDigest(value, nameAuthority) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeNodeState providerSpec',
  );
  if (!isPlainObject(nameAuthority)) {
    throw new TypeError(
      'awsSingleNodeNodeState nameAuthority must be an object.',
    );
  }
  assertExactKeys(
    nameAuthority,
    NAME_AUTHORITY_KEYS,
    'awsSingleNodeNodeState nameAuthority',
  );
  if (nameAuthority.providerScopeId !== providerSpec.providerScopeId) {
    throw new Error(
      'awsSingleNodeNodeState nameAuthority does not match the provider specification.',
    );
  }
  const instanceProfileName =
    getAwsSingleNodeRuntimeInstanceProfileName(nameAuthority);
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2InstanceState',
    machineImage: providerSpec.machineImage,
    placement: providerSpec.placement,
    ebsKmsKeyArn: providerSpec.storage.ebsKmsKeyArn,
    node: providerSpec.node,
    instanceProfileName,
    onDestroy: 'purge',
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_NODE_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/** @param {unknown} actionId @param {unknown} ownershipNonce @returns {string} */
export function getAwsSingleNodeNodeCreateClientToken(
  actionId,
  ownershipNonce,
) {
  assertDomainSeparatedSha256Id(
    actionId,
    DEPLOYMENT_ACTION_ID_PREFIX,
    'awsSingleNodeNode clientToken actionId',
  );
  const nonce = validateOwnershipNonce(
    ownershipNonce,
    'awsSingleNodeNode clientToken ownershipNonce',
  );
  const payload = JSON.stringify(
    sortCanonicalJsonValue({ actionId, ownershipNonce: nonce }),
  );
  return Buffer.from(
    sha256Base64Url(
      `${AWS_SINGLE_NODE_NODE_CREATE_CLIENT_TOKEN_DOMAIN}\0${payload}`,
    ),
    'base64url',
  ).toString('hex');
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

/** @param {Readonly<Record<string, string>>} instanceTags @returns {Readonly<Record<string, string>>} */
function rootVolumeTags(instanceTags) {
  return deepFreeze({
    ...instanceTags,
    'wharfie:resource-kind': 'single-node-substrate-root-volume',
  });
}

/** @param {unknown} value @param {Readonly<Record<string, string>>} expected @param {boolean} allowPropagation @returns {void} */
function validateManagedTags(value, expected, allowPropagation) {
  if (!Array.isArray(value)) {
    if (allowPropagation && (value === undefined || value === null)) {
      throw new NodeEvidenceTransientError();
    }
    if (value === undefined || value === null) {
      throw new NodeEvidenceConflictError();
    }
    throw new ProviderResponseUnknownError();
  }
  if (value.length > MAX_INSTANCE_TAGS) throw new NodeEvidenceConflictError();
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
    if (observed.has(tag.Key)) throw new NodeEvidenceConflictError();
    observed.set(tag.Key, tag.Value);
  }
  for (const [key, value] of observed) {
    const reserved = Object.hasOwn(expected, key);
    if (key.startsWith('wharfie:') && !reserved) {
      throw new NodeEvidenceConflictError();
    }
    if (reserved && expected[key] !== value) {
      throw new NodeEvidenceConflictError();
    }
  }
  if (
    !Object.entries(expected).every(
      ([key, expectedValue]) => observed.get(key) === expectedValue,
    )
  ) {
    if (allowPropagation) throw new NodeEvidenceTransientError();
    throw new NodeEvidenceConflictError();
  }
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
        Tags: recovery.sortedTags(rootVolumeTags(instanceTags)),
      },
    ],
  });
}

/** @param {unknown} response @param {Readonly<Record<string, any>>} providerScope @param {boolean} exact @returns {{records: Readonly<Record<string, any>>[], nextToken: string|null}} */
function instanceResponsePage(response, providerScope, exact) {
  if (!isPlainObject(response) || !Array.isArray(response.Reservations)) {
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
    if (exact) throw new NodeEvidenceConflictError();
    nextToken = response.NextToken;
  }
  const records = [];
  for (const reservation of response.Reservations) {
    if (
      !isPlainObject(reservation) ||
      typeof reservation.OwnerId !== 'string' ||
      !Array.isArray(reservation.Instances)
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (reservation.OwnerId !== providerScope.accountId) {
      throw new NodeEvidenceConflictError();
    }
    for (const instance of reservation.Instances) {
      if (
        !isPlainObject(instance) ||
        typeof instance.InstanceId !== 'string' ||
        !AWS_EC2_INSTANCE_ID_PATTERN.test(instance.InstanceId)
      ) {
        throw new ProviderResponseUnknownError();
      }
      records.push(
        Object.freeze({
          ...instance,
          __wharfieReservationOwnerId: reservation.OwnerId,
        }),
      );
    }
  }
  return { records, nextToken };
}

/** @param {unknown} response @param {string} instanceId @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>|null} */
function oneInstanceFromResponse(response, instanceId, providerScope) {
  const page = instanceResponsePage(response, providerScope, true);
  if (page.records.length === 0) throw new ProviderResponseUnknownError();
  if (page.records.length !== 1) throw new NodeEvidenceConflictError();
  if (page.records[0].InstanceId !== instanceId) {
    throw new NodeEvidenceConflictError();
  }
  return page.records[0];
}

/** @param {unknown} response @param {Readonly<Record<string, any>>} authority @returns {string} */
function candidateInstanceId(response, authority) {
  if (!isPlainObject(response) || !Array.isArray(response.Instances)) {
    throw new ProviderResponseUnknownError();
  }
  if (response.Instances.length !== 1) throw new NodeEvidenceConflictError();
  const instance = response.Instances[0];
  if (
    !isPlainObject(instance) ||
    typeof instance.InstanceId !== 'string' ||
    !AWS_EC2_INSTANCE_ID_PATTERN.test(instance.InstanceId)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    (response.OwnerId !== undefined &&
      response.OwnerId !== authority.plan.providerScope.accountId) ||
    (instance.ClientToken !== undefined &&
      instance.ClientToken !== authority.clientToken)
  ) {
    throw new NodeEvidenceConflictError();
  }
  return instance.InstanceId;
}

/** @param {unknown} value @returns {'pending'|'running'|'shutting-down'|'terminated'|'stopping'|'stopped'} */
function validateInstanceState(value) {
  if (
    !isPlainObject(value) ||
    typeof value.Name !== 'string' ||
    !Number.isSafeInteger(value.Code) ||
    !Object.hasOwn(INSTANCE_STATES, value.Name)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (value.Code < 0 || (value.Code & 0xff) !== INSTANCE_STATES[value.Name]) {
    throw new NodeEvidenceConflictError();
  }
  return /** @type {'pending'|'running'|'shutting-down'|'terminated'|'stopping'|'stopped'} */ (
    value.Name
  );
}

/** @param {Readonly<Record<string, any>>} instance @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @param {boolean} allowTagPropagation @returns {string} */
function validateNodeIdentityEvidence(
  instance,
  authority,
  recovery,
  allowTagPropagation,
) {
  if (
    typeof instance.InstanceId !== 'string' ||
    !AWS_EC2_INSTANCE_ID_PATTERN.test(instance.InstanceId) ||
    instance.__wharfieReservationOwnerId !==
      authority.plan.providerScope.accountId ||
    typeof instance.ClientToken !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    instance.ClientToken !== authority.clientToken ||
    (authority.priorBinding !== null &&
      instance.InstanceId !== authority.priorBinding.providerResourceId)
  ) {
    throw new NodeEvidenceConflictError();
  }
  recovery.validateTags(
    instance.Tags,
    recovery.requiredTags(authority),
    allowTagPropagation,
  );
  return validateInstanceState(instance.State);
}

/** @param {unknown} value @returns {boolean} */
function absent(value) {
  return value === undefined || value === null;
}

/** @param {unknown} value @returns {boolean} */
function emptyArray(value) {
  return (
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** @param {unknown} value @param {string} publicIp @returns {void} */
function validateAutoPublicIpv4Association(value, publicIp) {
  if (
    !isPlainObject(value) ||
    typeof value.PublicIp !== 'string' ||
    !isIPv4(value.PublicIp) ||
    typeof value.IpOwnerId !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    value.PublicIp !== publicIp ||
    value.IpOwnerId !== 'amazon' ||
    !absent(value.AllocationId) ||
    !absent(value.AssociationId) ||
    !absent(value.CarrierIp) ||
    !absent(value.CustomerOwnedIp)
  ) {
    throw new NodeEvidenceConflictError();
  }
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} node @returns {{rootVolumeId: string}} */
function validateInstanceBlockDeviceMappings(value, node) {
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  const deviceNames = new Set();
  const volumeIds = new Set();
  let rootVolumeId = null;
  for (const mapping of value) {
    if (
      !isPlainObject(mapping) ||
      typeof mapping.DeviceName !== 'string' ||
      mapping.DeviceName.length === 0 ||
      !isPlainObject(mapping.Ebs) ||
      typeof mapping.Ebs.VolumeId !== 'string' ||
      !VOLUME_ID_PATTERN.test(mapping.Ebs.VolumeId) ||
      typeof mapping.Ebs.DeleteOnTermination !== 'boolean' ||
      typeof mapping.Ebs.Status !== 'string'
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (
      deviceNames.has(mapping.DeviceName) ||
      volumeIds.has(mapping.Ebs.VolumeId)
    ) {
      throw new NodeEvidenceConflictError();
    }
    deviceNames.add(mapping.DeviceName);
    volumeIds.add(mapping.Ebs.VolumeId);
    if (
      mapping.Ebs.Status === 'attaching' ||
      mapping.Ebs.Status === 'detaching'
    ) {
      throw new NodeEvidenceTransientError();
    }
    if (mapping.Ebs.Status !== 'attached') {
      throw new NodeEvidenceConflictError();
    }
    if (
      mapping.Ebs.EbsCardIndex !== undefined &&
      mapping.Ebs.EbsCardIndex !== 0
    ) {
      throw new NodeEvidenceConflictError();
    }
    if (
      !absent(mapping.Ebs.AssociatedResource) ||
      !absent(mapping.Ebs.VolumeOwnerId)
    ) {
      throw new NodeEvidenceConflictError();
    }
    if (mapping.DeviceName === node.rootVolume.deviceName) {
      if (
        mapping.Ebs.DeleteOnTermination !== node.rootVolume.deleteOnTermination
      ) {
        throw new NodeEvidenceConflictError();
      }
      rootVolumeId = mapping.Ebs.VolumeId;
    } else if (mapping.Ebs.DeleteOnTermination !== false) {
      // Retained descendants may attach later, but terminating the node must
      // never implicitly delete a non-root volume.
      throw new NodeEvidenceConflictError();
    }
  }
  if (rootVolumeId === null) throw new NodeEvidenceConflictError();
  return { rootVolumeId };
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} node @returns {string|null} */
function terminalRootVolumeId(value, node) {
  if (absent(value)) return null;
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  const deviceNames = new Set();
  const volumeIds = new Set();
  let rootVolumeId = null;
  for (const mapping of value) {
    if (
      !isPlainObject(mapping) ||
      typeof mapping.DeviceName !== 'string' ||
      mapping.DeviceName.length === 0 ||
      !isPlainObject(mapping.Ebs) ||
      typeof mapping.Ebs.VolumeId !== 'string' ||
      !VOLUME_ID_PATTERN.test(mapping.Ebs.VolumeId) ||
      typeof mapping.Ebs.DeleteOnTermination !== 'boolean' ||
      typeof mapping.Ebs.Status !== 'string'
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (
      deviceNames.has(mapping.DeviceName) ||
      volumeIds.has(mapping.Ebs.VolumeId)
    ) {
      throw new NodeEvidenceConflictError();
    }
    deviceNames.add(mapping.DeviceName);
    volumeIds.add(mapping.Ebs.VolumeId);
    if (
      !['attaching', 'attached', 'detaching', 'detached'].includes(
        mapping.Ebs.Status,
      ) ||
      (mapping.Ebs.EbsCardIndex !== undefined &&
        mapping.Ebs.EbsCardIndex !== 0) ||
      !absent(mapping.Ebs.AssociatedResource) ||
      !absent(mapping.Ebs.VolumeOwnerId)
    ) {
      throw new NodeEvidenceConflictError();
    }
    if (mapping.DeviceName === node.rootVolume.deviceName) {
      if (
        mapping.Ebs.DeleteOnTermination !== node.rootVolume.deleteOnTermination
      ) {
        throw new NodeEvidenceConflictError();
      }
      rootVolumeId = mapping.Ebs.VolumeId;
    } else if (mapping.Ebs.DeleteOnTermination !== false) {
      throw new NodeEvidenceConflictError();
    }
  }
  return rootVolumeId;
}

/** @param {Readonly<Record<string, any>>} instance @param {Readonly<Record<string, any>>} authority @param {'running'|'stopped'} state @returns {{rootVolumeId: string}} */
function validateRunningInstanceEvidence(instance, authority, state) {
  const spec = authority.providerSpec;
  const node = spec.node;
  if (
    instance.ImageId !== spec.machineImage.imageId ||
    instance.Architecture !== spec.machineImage.architecture ||
    instance.InstanceType !== node.instanceType ||
    instance.AmiLaunchIndex !== 0 ||
    instance.EbsOptimized !== node.ebsOptimized ||
    instance.EnaSupport !== spec.machineImage.enaSupport ||
    instance.VirtualizationType !== spec.machineImage.virtualizationType ||
    instance.RootDeviceName !== node.rootVolume.deviceName ||
    instance.RootDeviceType !== spec.machineImage.rootDeviceType ||
    instance.VpcId !== authority.vpcId ||
    instance.SubnetId !== authority.subnetId ||
    instance.SourceDestCheck !== node.primaryNetworkInterface.sourceDestCheck ||
    !absent(instance.KeyName) ||
    !absent(instance.InstanceLifecycle) ||
    !absent(instance.SpotInstanceRequestId) ||
    !absent(instance.CapacityBlockId)
  ) {
    throw new NodeEvidenceConflictError();
  }
  if (!Array.isArray(instance.SecurityGroups)) {
    throw new ProviderResponseUnknownError();
  }
  if (
    instance.SecurityGroups.length !== 1 ||
    instance.SecurityGroups[0]?.GroupId !== authority.securityGroupId
  ) {
    throw new NodeEvidenceConflictError();
  }
  if (
    !isPlainObject(instance.Placement) ||
    !isPlainObject(instance.Monitoring) ||
    !isPlainObject(instance.CapacityReservationSpecification) ||
    !isPlainObject(instance.HibernationOptions) ||
    !isPlainObject(instance.EnclaveOptions) ||
    !isPlainObject(instance.MetadataOptions) ||
    !isPlainObject(instance.PrivateDnsNameOptions) ||
    !isPlainObject(instance.MaintenanceOptions) ||
    !isPlainObject(instance.IamInstanceProfile)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    instance.Placement.AvailabilityZoneId !==
      spec.placement.availabilityZoneId ||
    instance.Placement.Tenancy !== node.tenancy ||
    instance.Monitoring.State !== 'disabled' ||
    instance.CapacityReservationSpecification.CapacityReservationPreference !==
      node.capacityReservationPreference ||
    !absent(instance.CapacityReservationId) ||
    !absent(
      instance.CapacityReservationSpecification.CapacityReservationTarget,
    ) ||
    instance.HibernationOptions.Configured !== node.hibernation ||
    instance.EnclaveOptions.Enabled !== node.enclave ||
    instance.MetadataOptions.State !== 'applied' ||
    instance.MetadataOptions.HttpEndpoint !==
      node.metadataOptions.httpEndpoint ||
    instance.MetadataOptions.HttpTokens !== node.metadataOptions.httpTokens ||
    instance.MetadataOptions.HttpPutResponseHopLimit !==
      node.metadataOptions.httpPutResponseHopLimit ||
    instance.MetadataOptions.HttpProtocolIpv6 !==
      node.metadataOptions.httpProtocolIpv6 ||
    instance.MetadataOptions.InstanceMetadataTags !==
      node.metadataOptions.instanceMetadataTags ||
    instance.PrivateDnsNameOptions.HostnameType !==
      node.privateDnsNameOptions.hostnameType ||
    instance.PrivateDnsNameOptions.EnableResourceNameDnsARecord !==
      node.privateDnsNameOptions.enableResourceNameDnsARecord ||
    instance.PrivateDnsNameOptions.EnableResourceNameDnsAAAARecord !==
      node.privateDnsNameOptions.enableResourceNameDnsAaaaRecord ||
    instance.MaintenanceOptions.AutoRecovery !== node.maintenanceAutoRecovery ||
    instance.IamInstanceProfile.Id !== authority.instanceProfileId ||
    instance.IamInstanceProfile.Arn !== authority.instanceProfileArn
  ) {
    throw new NodeEvidenceConflictError();
  }
  if (!Array.isArray(instance.NetworkInterfaces)) {
    throw new ProviderResponseUnknownError();
  }
  if (instance.NetworkInterfaces.length !== 1) {
    throw new NodeEvidenceConflictError();
  }
  const network = instance.NetworkInterfaces[0];
  const expectedNetwork = node.primaryNetworkInterface;
  if (
    !isPlainObject(network) ||
    typeof network.NetworkInterfaceId !== 'string' ||
    !NETWORK_INTERFACE_ID_PATTERN.test(network.NetworkInterfaceId) ||
    !isPlainObject(network.Attachment) ||
    !Array.isArray(network.Groups) ||
    !Array.isArray(network.PrivateIpAddresses)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    network.OwnerId !== authority.plan.providerScope.accountId ||
    network.InterfaceType !== expectedNetwork.interfaceType ||
    network.Description !== expectedNetwork.description ||
    network.VpcId !== authority.vpcId ||
    network.SubnetId !== authority.subnetId ||
    network.SourceDestCheck !== expectedNetwork.sourceDestCheck ||
    network.Status !== 'in-use' ||
    network.Attachment.DeviceIndex !== expectedNetwork.deviceIndex ||
    network.Attachment.NetworkCardIndex !== expectedNetwork.networkCardIndex ||
    network.Attachment.DeleteOnTermination !==
      expectedNetwork.deleteOnTermination ||
    network.Attachment.Status !== 'attached' ||
    network.Groups.length !== 1 ||
    network.Groups[0]?.GroupId !== authority.securityGroupId ||
    network.PrivateIpAddresses.length !== 1 ||
    network.PrivateIpAddresses[0]?.Primary !== true ||
    !isIPv4(instance.PrivateIpAddress) ||
    !isIPv4(network.PrivateIpAddress) ||
    network.PrivateIpAddress !== instance.PrivateIpAddress ||
    typeof network.PrivateIpAddresses[0]?.PrivateIpAddress !== 'string' ||
    !isIPv4(network.PrivateIpAddresses[0].PrivateIpAddress) ||
    network.PrivateIpAddresses[0].PrivateIpAddress !==
      instance.PrivateIpAddress ||
    !emptyArray(network.Ipv6Addresses) ||
    !emptyArray(network.Ipv4Prefixes) ||
    !emptyArray(network.Ipv6Prefixes)
  ) {
    throw new NodeEvidenceConflictError();
  }
  const association = network.Association;
  const privateAssociation = network.PrivateIpAddresses[0].Association;
  if (state === 'stopped') {
    if (
      absent(association) &&
      absent(privateAssociation) &&
      absent(instance.PublicIpAddress)
    ) {
      return validateInstanceBlockDeviceMappings(
        instance.BlockDeviceMappings,
        node,
      );
    }
    if (
      typeof instance.PublicIpAddress !== 'string' ||
      instance.PublicIpAddress.length === 0 ||
      !isIPv4(instance.PublicIpAddress)
    ) {
      throw new ProviderResponseUnknownError();
    }
    validateAutoPublicIpv4Association(association, instance.PublicIpAddress);
    validateAutoPublicIpv4Association(
      privateAssociation,
      instance.PublicIpAddress,
    );
    // The stopped state can become visible before EC2 releases its ephemeral
    // Amazon-owned public association. Never restart from that mixed sample.
    throw new NodeEvidenceTransientError();
  } else {
    if (association === undefined || association === null) {
      throw new NodeEvidenceTransientError();
    }
    if (
      typeof instance.PublicIpAddress !== 'string' ||
      instance.PublicIpAddress.length === 0 ||
      !isIPv4(instance.PublicIpAddress)
    ) {
      throw new ProviderResponseUnknownError();
    }
    validateAutoPublicIpv4Association(association, instance.PublicIpAddress);
    validateAutoPublicIpv4Association(
      privateAssociation,
      instance.PublicIpAddress,
    );
  }
  return validateInstanceBlockDeviceMappings(
    instance.BlockDeviceMappings,
    node,
  );
}

/** @param {unknown} response @param {string} instanceId @param {string} attribute @param {unknown} expected @returns {void} */
function validateInstanceAttribute(response, instanceId, attribute, expected) {
  /** @type {Readonly<Record<string, string>>} */
  const responseKeys = Object.freeze({
    userData: 'UserData',
    disableApiTermination: 'DisableApiTermination',
    disableApiStop: 'DisableApiStop',
    instanceInitiatedShutdownBehavior: 'InstanceInitiatedShutdownBehavior',
  });
  const responseKey = responseKeys[attribute];
  if (
    !isPlainObject(response) ||
    response.InstanceId !== instanceId ||
    typeof responseKey !== 'string' ||
    !isPlainObject(response[responseKey]) ||
    !Object.hasOwn(response[responseKey], 'Value')
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (response[responseKey].Value !== expected) {
    throw new NodeEvidenceConflictError();
  }
}

/** @param {unknown} response @param {string} instanceId @param {string} expected @returns {void} */
function validateCreditSpecification(response, instanceId, expected) {
  if (
    !isPlainObject(response) ||
    !Array.isArray(response.InstanceCreditSpecifications)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new NodeEvidenceConflictError();
  }
  if (response.InstanceCreditSpecifications.length !== 1) {
    throw new NodeEvidenceConflictError();
  }
  const credit = response.InstanceCreditSpecifications[0];
  if (
    !isPlainObject(credit) ||
    typeof credit.InstanceId !== 'string' ||
    typeof credit.CpuCredits !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (credit.InstanceId !== instanceId || credit.CpuCredits !== expected) {
    throw new NodeEvidenceConflictError();
  }
}

/** @param {unknown} response @param {string} volumeId @returns {Readonly<Record<string, any>>} */
function oneVolumeFromResponse(response, volumeId) {
  if (!isPlainObject(response) || !Array.isArray(response.Volumes)) {
    throw new ProviderResponseUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new NodeEvidenceConflictError();
  }
  if (response.Volumes.length === 0) {
    throw new ProviderResponseUnknownError();
  }
  if (response.Volumes.length !== 1) throw new NodeEvidenceConflictError();
  const volume = response.Volumes[0];
  if (
    !isPlainObject(volume) ||
    typeof volume.VolumeId !== 'string' ||
    !VOLUME_ID_PATTERN.test(volume.VolumeId)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (volume.VolumeId !== volumeId) throw new NodeEvidenceConflictError();
  return volume;
}

/** @param {unknown} response @param {boolean} exact @returns {{records: Readonly<Record<string, any>>[], nextToken: string|null}} */
function volumeResponsePage(response, exact) {
  if (!isPlainObject(response) || !Array.isArray(response.Volumes)) {
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
    if (exact) throw new NodeEvidenceConflictError();
    nextToken = response.NextToken;
  }
  const records = [];
  for (const volume of response.Volumes) {
    if (
      !isPlainObject(volume) ||
      typeof volume.VolumeId !== 'string' ||
      !VOLUME_ID_PATTERN.test(volume.VolumeId)
    ) {
      throw new ProviderResponseUnknownError();
    }
    records.push(volume);
  }
  return { records, nextToken };
}

/** @param {Readonly<Record<string, any>>} volume @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, string>>} expectedTags @param {boolean} allowTagPropagation @returns {void} */
function validateRootVolumeIntrinsicEvidence(
  volume,
  authority,
  expectedTags,
  allowTagPropagation,
) {
  const root = authority.providerSpec.node.rootVolume;
  for (const key of ['AvailabilityZoneId', 'VolumeType', 'KmsKeyId', 'State']) {
    if (typeof volume[key] !== 'string') {
      throw new ProviderResponseUnknownError();
    }
  }
  for (const key of ['Size', 'Iops', 'Throughput']) {
    if (!Number.isSafeInteger(volume[key])) {
      throw new ProviderResponseUnknownError();
    }
  }
  if (
    typeof volume.Encrypted !== 'boolean' ||
    typeof volume.MultiAttachEnabled !== 'boolean' ||
    !Array.isArray(volume.Attachments)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    volume.AvailabilityZoneId !==
      authority.providerSpec.placement.availabilityZoneId ||
    volume.SnapshotId !== root.snapshotId ||
    volume.VolumeType !== root.volumeType ||
    volume.Size !== root.sizeGiB ||
    volume.Iops !== root.iops ||
    volume.Throughput !== root.throughputMiBps ||
    volume.Encrypted !== root.encrypted ||
    volume.KmsKeyId !== authority.providerSpec.storage.ebsKmsKeyArn ||
    volume.MultiAttachEnabled !== root.multiAttach ||
    !absent(volume.SourceVolumeId) ||
    !absent(volume.OutpostArn) ||
    (volume.VolumeInitializationRate !== undefined &&
      volume.VolumeInitializationRate !== null) ||
    (volume.SseType !== undefined && volume.SseType !== 'sse-kms')
  ) {
    throw new NodeEvidenceConflictError();
  }
  if (volume.Operator !== undefined && volume.Operator !== null) {
    if (
      !isPlainObject(volume.Operator) ||
      typeof volume.Operator.Managed !== 'boolean'
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (volume.Operator.Managed || !absent(volume.Operator.Principal)) {
      throw new NodeEvidenceConflictError();
    }
  }
  validateManagedTags(volume.Tags, expectedTags, allowTagPropagation);
}

/** @param {Readonly<Record<string, any>>} attachment @param {Readonly<Record<string, any>>} volume @param {Readonly<Record<string, any>>} authority @param {string} instanceId @returns {string} */
function validateRootVolumeAttachment(
  attachment,
  volume,
  authority,
  instanceId,
) {
  const root = authority.providerSpec.node.rootVolume;
  if (!isPlainObject(attachment) || typeof attachment.State !== 'string') {
    throw new ProviderResponseUnknownError();
  }
  if (
    attachment.VolumeId !== volume.VolumeId ||
    attachment.InstanceId !== instanceId ||
    attachment.Device !== root.deviceName ||
    attachment.DeleteOnTermination !== root.deleteOnTermination ||
    !absent(attachment.AssociatedResource) ||
    !absent(attachment.InstanceOwningService) ||
    (attachment.EbsCardIndex !== undefined && attachment.EbsCardIndex !== 0)
  ) {
    throw new NodeEvidenceConflictError();
  }
  if (
    !['attaching', 'attached', 'detaching', 'detached', 'busy'].includes(
      attachment.State,
    )
  ) {
    throw new NodeEvidenceConflictError();
  }
  return attachment.State;
}

/** @param {Readonly<Record<string, any>>} volume @param {Readonly<Record<string, any>>} authority @param {string} instanceId @param {Readonly<Record<string, any>>} recovery @returns {void} */
function validateRootVolumeEvidence(volume, authority, instanceId, recovery) {
  validateRootVolumeIntrinsicEvidence(
    volume,
    authority,
    rootVolumeTags(recovery.requiredTags(authority)),
    authority.action.action === 'create',
  );
  if (volume.State === 'creating') throw new NodeEvidenceTransientError();
  if (volume.State !== 'in-use') throw new NodeEvidenceConflictError();
  if (volume.Attachments.length !== 1) throw new NodeEvidenceConflictError();
  const attachment = volume.Attachments[0];
  const state = validateRootVolumeAttachment(
    attachment,
    volume,
    authority,
    instanceId,
  );
  if (state === 'attaching') throw new NodeEvidenceTransientError();
  if (state !== 'attached') throw new NodeEvidenceConflictError();
}

/** @param {Readonly<Record<string, any>>} volume @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} rootRecovery @returns {'deleted'|'not-converged'} */
function validateRootVolumePurgeEvidence(volume, authority, rootRecovery) {
  validateRootVolumeIntrinsicEvidence(
    volume,
    authority,
    rootRecovery.requiredTags(authority),
    false,
  );
  const instanceId = authority.priorBinding.providerResourceId;
  if (volume.Attachments.length > 1) throw new NodeEvidenceConflictError();
  let attachmentState = null;
  if (volume.Attachments.length === 1) {
    attachmentState = validateRootVolumeAttachment(
      volume.Attachments[0],
      volume,
      authority,
      instanceId,
    );
  }
  if (volume.State === 'deleted') {
    if (attachmentState !== null) throw new NodeEvidenceConflictError();
    return 'deleted';
  }
  if (volume.State === 'deleting') return 'not-converged';
  if (volume.State === 'in-use') {
    if (
      attachmentState !== 'attached' &&
      attachmentState !== 'detaching' &&
      attachmentState !== 'busy'
    ) {
      throw new NodeEvidenceConflictError();
    }
    return 'not-converged';
  }
  // Once the bound instance is terminal, an available root is an orphan and
  // neither this driver nor TerminateInstances has a remaining repair effect.
  throw new NodeEvidenceConflictError();
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
    return oneInstanceFromResponse(response, instanceId, providerScope);
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<{records: Readonly<Record<string, any>>[], nextToken: string|null}>} */
  async function readDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeInstances(request);
    } catch {
      throw new ProviderResponseUnknownError();
    }
    return instanceResponsePage(response, providerScope, false);
  }

  const recovery = createAwsTaggedEc2RecoveryKernel({
    baseTags: BASE_INSTANCE_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS,
    idKey: 'InstanceId',
    idPattern: AWS_EC2_INSTANCE_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES,
    maxTags: MAX_INSTANCE_TAGS,
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
    return oneVolumeFromResponse(response, volumeId);
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<{records: Readonly<Record<string, any>>[], nextToken: string|null}>} */
  async function readRootVolumeDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeVolumes(request);
    } catch {
      throw new ProviderResponseUnknownError();
    }
    return volumeResponsePage(response, false);
  }

  const rootRecovery = createAwsTaggedEc2RecoveryKernel({
    baseTags: BASE_ROOT_VOLUME_TAGS,
    discoveryMaxResults: ROOT_VOLUME_DISCOVERY_MAX_RESULTS,
    idKey: 'VolumeId',
    idPattern: VOLUME_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES,
    maxTags: MAX_INSTANCE_TAGS,
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
      validateManagedTags(evidence.discovered.Tags, expectedTags, false);
    }
    if (evidence.exact !== null) {
      validateManagedTags(evidence.exact.Tags, expectedTags, false);
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
        : terminalRootVolumeId(
            terminalInstance.BlockDeviceMappings,
            authority.providerSpec.node,
          );
    const volume = await readRootVolumeIdentity(authority, rootVolumeId);
    if (volume === null) {
      return rootVolumeId === null ? 'logically-absent' : 'exactly-absent';
    }
    return validateRootVolumePurgeEvidence(volume, authority, rootRecovery);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readNodeIdentity(authority) {
    const evidence = await recovery.readIdentityEvidence(authority, {
      useDiscoveredId: true,
    });
    const allowTagPropagation = authority.action.action === 'create';
    if (evidence.discovered !== null) {
      validateNodeIdentityEvidence(
        evidence.discovered,
        authority,
        recovery,
        allowTagPropagation,
      );
    }
    if (evidence.exact !== null) {
      validateNodeIdentityEvidence(
        evidence.exact,
        authority,
        recovery,
        allowTagPropagation,
      );
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
    const { rootVolumeId } = validateRunningInstanceEvidence(
      instance,
      authority,
      state,
    );
    const instanceId = instance.InstanceId;
    let responses;
    try {
      responses = await Promise.all([
        readAttribute(instanceId, 'userData'),
        readAttribute(instanceId, 'disableApiTermination'),
        readAttribute(instanceId, 'disableApiStop'),
        readAttribute(instanceId, 'instanceInitiatedShutdownBehavior'),
        client.describeInstanceCreditSpecifications(
          deepFreeze({ InstanceIds: [instanceId] }),
        ),
        client.describeVolumes(deepFreeze({ VolumeIds: [rootVolumeId] })),
      ]);
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
    validateInstanceAttribute(
      responses[0],
      instanceId,
      'userData',
      getAwsSingleNodeBootstrapBase64(),
    );
    validateInstanceAttribute(
      responses[1],
      instanceId,
      'disableApiTermination',
      authority.providerSpec.node.terminationProtection,
    );
    validateInstanceAttribute(
      responses[2],
      instanceId,
      'disableApiStop',
      authority.providerSpec.node.stopProtection,
    );
    validateInstanceAttribute(
      responses[3],
      instanceId,
      'instanceInitiatedShutdownBehavior',
      authority.providerSpec.node.instanceInitiatedShutdownBehavior,
    );
    validateCreditSpecification(
      responses[4],
      instanceId,
      authority.providerSpec.node.cpuCredits,
    );
    const rootVolume = oneVolumeFromResponse(responses[5], rootVolumeId);
    validateRootVolumeEvidence(rootVolume, authority, instanceId, recovery);
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
          candidateInstanceId(response, authority),
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
      state = validateInstanceState(instance.State);
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
          refreshedState = validateInstanceState(refreshed.State);
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
          const state = validateInstanceState(instance.State);
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
