/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import {
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_PREFIX,
} from './deployment-aws-default-ipv4-route-resource.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from './deployment-aws-desired-resource-targets.js';
import {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
} from './deployment-aws-internet-gateway-attachment-resource.js';
import {
  AWS_SINGLE_NODE_NODE_BASE_INSTANCE_TAGS,
  AWS_SINGLE_NODE_NODE_BASE_ROOT_VOLUME_TAGS,
  AWS_SINGLE_NODE_NODE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_NODE_MAX_TAGS,
  AWS_SINGLE_NODE_NODE_ROOT_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_NODE_VOLUME_ID_PATTERN,
  AwsSingleNodeNodeEvidenceConflictError,
  AwsSingleNodeNodeEvidenceTransientError,
  AwsSingleNodeNodeEvidenceUnknownError,
  createAwsSingleNodeNodeReadableState,
  decodeAwsSingleNodeNodeCreditSpecification,
  decodeAwsSingleNodeNodeExactInstanceResponse,
  decodeAwsSingleNodeNodeExactRootVolumeResponse,
  decodeAwsSingleNodeNodeIdentityEvidence,
  decodeAwsSingleNodeNodeInstanceAttribute,
  decodeAwsSingleNodeNodeInstancePage,
  decodeAwsSingleNodeNodeInstanceState,
  decodeAwsSingleNodeNodeRootVolumePage,
  decodeAwsSingleNodeNodeRootVolumePurgeEvidence,
  decodeAwsSingleNodeNodeRootVolumeState,
  decodeAwsSingleNodeNodeTerminalRootVolumeId,
  getAwsSingleNodeNodeCreateClientToken,
  getAwsSingleNodeNodeLifecycleHealth,
  getAwsSingleNodeNodeObservedStateDigest,
  getAwsSingleNodeNodeRootVolumeTags,
  getAwsSingleNodeNodeStateDigest,
  validateAwsSingleNodeNodeManagedTags,
} from './deployment-aws-node-evidence.js';
import { createAwsSingleNodeDestroyedResourceLocator } from './deployment-aws-destroyed-resource-locator.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import {
  AWS_EC2_INSTANCE_ID_PATTERN,
  AWS_IAM_INSTANCE_PROFILE_ID_PATTERN,
  AWS_IAM_ROLE_ID_PATTERN,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeInstanceProfileName,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
} from './deployment-aws-runtime-identity-contract.js';
import {
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_PREFIX,
} from './deployment-aws-subnet-route-table-association-resource.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
  createAwsTaggedEc2EvidenceKernel,
} from './deployment-aws-tagged-ec2-evidence.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import { assertDeploymentActionId } from './deployment-resource-binding.js';
import { getAwsSingleNodeResourceDefinition } from './deployment-resource-graph.js';
import { createCanonicalJsonSha256Id } from './content-id.js';

export {
  AWS_SINGLE_NODE_NODE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES,
};

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set([
  'describeInstances',
  'describeInstanceAttribute',
  'describeInstanceCreditSpecifications',
  'describeVolumes',
]);
const AUTHORITY_REQUIRED_KEYS = new Set([
  'operation',
  'deploymentRevision',
  'profile',
  'providerScope',
  'providerSpec',
  'deploymentInstanceId',
  'incarnationId',
  'head',
  'plan',
  'settledPlan',
  'target',
  'binding',
  'currentAction',
]);
const AUTHORITY_KEYS = new Set([
  ...AUTHORITY_REQUIRED_KEYS,
  'destroyedResourceLocator',
]);
const RESOURCE_KEY = 'substrate';
const PROVIDER_TYPE = 'ec2-instance';
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
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,32}$/;
const SECURITY_GROUP_ID_PATTERN = /^sg-[0-9a-f]{8,32}$/;
const INTERNET_GATEWAY_ID_PATTERN = /^igw-[0-9a-f]{8,32}$/;
const ROUTE_TABLE_ID_PATTERN = /^rtb-[0-9a-f]{8,32}$/;
const AUTHORITY_ERROR =
  'AWS single-node node observation authority does not match the exact substrate contract.';

/** Exact durable authority cannot select this managed substrate read mode. */
export class AwsSingleNodeNodeResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'AwsSingleNodeNodeResourceObserverAuthorityError';
    this.code = 'AWS_SINGLE_NODE_NODE_RESOURCE_OBSERVER_AUTHORITY';
  }
}

/** Internal conclusive contradiction with one discovered provider identity. */
class NodeCandidateConflictError extends Error {
  /** @param {string} providerResourceId - Exact contradictory candidate ID. */
  constructor(providerResourceId) {
    super('AWS single-node node candidate conflicts with exact evidence.');
    this.name = 'NodeCandidateConflictError';
    this.providerResourceId = providerResourceId;
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
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
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

/** @param {unknown} authority @returns {Readonly<Record<string, any>>} */
function revalidateAuthority(authority) {
  if (!isPlainObject(authority)) {
    throw new TypeError(
      'awsSingleNodeNodeResourceObserver context must be an object.',
    );
  }
  assertSupportedKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeNodeResourceObserver context',
  );
  assertRequiredKeys(
    authority,
    AUTHORITY_REQUIRED_KEYS,
    'awsSingleNodeNodeResourceObserver context',
  );
  const canonical = createAwsSingleNodeResourceObservationAuthority({
    operation: authority.operation,
    deploymentRevision: authority.deploymentRevision,
    profile: authority.profile,
    providerScope: authority.providerScope,
    providerSpec: authority.providerSpec,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
    head: authority.head,
    plan: authority.plan,
    settledPlan: authority.settledPlan,
    target: authority.target,
  });
  const expectedDestroyedResourceLocator =
    createAwsSingleNodeDestroyedResourceLocator(canonical);
  const destroyedResourceLocator = Object.hasOwn(
    authority,
    'destroyedResourceLocator',
  )
    ? authority.destroyedResourceLocator
    : null;
  if (
    !sameJson(authority.binding, canonical.binding) ||
    !sameJson(authority.currentAction, canonical.currentAction) ||
    !sameJson(destroyedResourceLocator, expectedDestroyedResourceLocator)
  ) {
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
  return expectedDestroyedResourceLocator === null
    ? canonical
    : deepFreeze({
        ...canonical,
        destroyedResourceLocator: expectedDestroyedResourceLocator,
      });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function nameAuthority(authority) {
  return deepFreeze({
    providerScopeId: authority.providerScope.providerScopeId,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function locator(authority) {
  return deepFreeze({
    capabilityKind: authority.target.capability.kind,
    roleKind: authority.target.role.kind,
    providerScopeId: authority.providerScope.providerScopeId,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
    resourceKey: RESOURCE_KEY,
  });
}

/** @param {unknown} tags @param {string} key @returns {string} */
function exactTagValue(tags, key) {
  if (!Array.isArray(tags)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  const values = [];
  for (const tag of tags) {
    if (
      !isPlainObject(tag) ||
      typeof tag.Key !== 'string' ||
      typeof tag.Value !== 'string'
    ) {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    if (tag.Key === key) values.push(tag.Value);
  }
  if (values.length !== 1) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  return values[0];
}

/** @param {string} domain @param {string} prefix @param {unknown} value @returns {string} */
function syntheticProviderId(domain, prefix, value) {
  return createCanonicalJsonSha256Id({ domain, prefix, value });
}

/** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} target @returns {boolean} */
function actionMatchesTarget(action, target) {
  const state = action.action === 'delete' ? action.before : action.after;
  return (
    action.resourceKey === target.resourceKey &&
    sameJson(action.capability, target.capability) &&
    sameJson(action.role, target.role) &&
    action.management === target.management &&
    action.ownershipMode === target.ownershipMode &&
    action.onDestroy === target.onDestroy &&
    sameJson(action.dependsOn, target.dependsOn) &&
    state !== null &&
    state.providerType === target.target.providerType &&
    sameJson(state.stateDigest, target.target.stateDigest)
  );
}

/** @param {Readonly<Record<string, any>>} authority @param {string} resourceKey @param {Readonly<Record<string, any>>} target @param {Readonly<Record<string, any>>} binding @returns {boolean} */
function planProvesBinding(authority, resourceKey, target, binding) {
  /** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} intent @returns {boolean} */
  function proves(action, intent) {
    const state = action.action === 'delete' ? action.before : action.after;
    return (
      intent.actionId === action.actionId &&
      actionMatchesTarget(action, target) &&
      (state.providerResourceId === null ||
        state.providerResourceId === binding.providerResourceId) &&
      (binding.management !== 'managed' ||
        intent.ownershipNonce === binding.ownershipNonce) &&
      (action.action !== 'create' ||
        binding.createdByActionId === action.actionId)
    );
  }
  if (authority.plan !== null && authority.head.activeOperation !== null) {
    const targetIndex = authority.plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ action) =>
        action.resourceKey === RESOURCE_KEY,
    );
    const index = authority.plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ action) =>
        action.resourceKey === resourceKey,
    );
    const action = authority.plan.actions[index];
    const intent = authority.head.activeOperation.intents[index];
    const positionAndStatus =
      authority.plan.operation === 'destroy'
        ? index > targetIndex && intent?.status === 'pending'
        : index < targetIndex && intent?.status === 'settled';
    if (
      targetIndex >= 0 &&
      index >= 0 &&
      action !== undefined &&
      intent !== undefined &&
      positionAndStatus &&
      proves(action, intent)
    ) {
      return true;
    }
  }
  if (authority.settledPlan !== null && authority.head.lastOperation !== null) {
    const index = authority.settledPlan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ action) =>
        action.resourceKey === resourceKey,
    );
    const action = authority.settledPlan.actions[index];
    const intent = authority.head.lastOperation.intents[index];
    if (
      index >= 0 &&
      action !== undefined &&
      intent?.status === 'settled' &&
      action.action !== 'delete' &&
      proves(action, intent)
    ) {
      return true;
    }
  }
  return false;
}

/** @param {Readonly<Record<string, any>>} authority @param {Map<string, Readonly<Record<string, any>>>} bindings @returns {void} */
function validateSpecificDependencyProviderIds(authority, bindings) {
  /** @param {string} key @returns {string|undefined} */
  const id = (key) => bindings.get(key)?.providerResourceId;
  let artifactArn;
  let gatewayAttachmentId;
  let defaultRouteId;
  let subnetAssociationId;
  let runtimePolicyId;
  let runtimeAssociationId;
  try {
    artifactArn = getAwsSingleNodeManagedArtifactObjectLocation({
      providerScope: authority.providerScope,
      deploymentInstanceId: authority.deploymentInstanceId,
      incarnationId: authority.incarnationId,
    }).arn;
    gatewayAttachmentId = syntheticProviderId(
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
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
  if (
    id('artifact') !== artifactArn ||
    !VPC_ID_PATTERN.test(id('network-vpc') ?? '') ||
    !INTERNET_GATEWAY_ID_PATTERN.test(id('network-internet-gateway') ?? '') ||
    id('network-internet-gateway-attachment') !== gatewayAttachmentId ||
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
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @param {Map<string, Readonly<Record<string, any>>>} bindings @returns {void} */
function validateExistingDependencyProviderIds(authority, bindings) {
  /** @param {string} key @returns {string|undefined} */
  const id = (key) => bindings.get(key)?.providerResourceId;
  try {
    if (
      bindings.has('artifact') &&
      id('artifact') !==
        getAwsSingleNodeManagedArtifactObjectLocation({
          providerScope: authority.providerScope,
          deploymentInstanceId: authority.deploymentInstanceId,
          incarnationId: authority.incarnationId,
        }).arn
    ) {
      throw new Error();
    }
    const patternedIds =
      /** @type {ReadonlyArray<readonly [string, RegExp]>} */ ([
        ['network-vpc', VPC_ID_PATTERN],
        ['network-internet-gateway', INTERNET_GATEWAY_ID_PATTERN],
        ['network-subnet', SUBNET_ID_PATTERN],
        ['network-route-table', ROUTE_TABLE_ID_PATTERN],
        ['network-security-group', SECURITY_GROUP_ID_PATTERN],
        ['runtime-role', AWS_IAM_ROLE_ID_PATTERN],
        ['runtime-identity', AWS_IAM_INSTANCE_PROFILE_ID_PATTERN],
      ]);
    for (const [key, pattern] of patternedIds) {
      if (bindings.has(key) && !pattern.test(id(key) ?? '')) {
        throw new Error();
      }
    }
    if (
      bindings.has('network-internet-gateway-attachment') &&
      id('network-internet-gateway-attachment') !==
        syntheticProviderId(
          AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
          AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
          {
            internetGatewayId: id('network-internet-gateway'),
            vpcId: id('network-vpc'),
          },
        )
    ) {
      throw new Error();
    }
    if (
      bindings.has('network-default-ipv4-route') &&
      id('network-default-ipv4-route') !==
        syntheticProviderId(
          AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_DOMAIN,
          AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_PREFIX,
          {
            destinationCidrBlock:
              authority.providerSpec.capabilities.networking.egressCidr,
            internetGatewayId: id('network-internet-gateway'),
            routeTableId: id('network-route-table'),
          },
        )
    ) {
      throw new Error();
    }
    if (
      bindings.has('network-subnet-route-table-association') &&
      id('network-subnet-route-table-association') !==
        syntheticProviderId(
          AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_DOMAIN,
          AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_PREFIX,
          {
            routeTableId: id('network-route-table'),
            subnetId: id('network-subnet'),
          },
        )
    ) {
      throw new Error();
    }
    if (
      bindings.has('runtime-role-policy') &&
      id('runtime-role-policy') !==
        getAwsSingleNodeRuntimePolicyProviderResourceId({
          runtimeRoleId: id('runtime-role'),
        })
    ) {
      throw new Error();
    }
    if (
      bindings.has('runtime-identity-role-association') &&
      id('runtime-identity-role-association') !==
        getAwsSingleNodeRuntimeAssociationProviderResourceId({
          runtimeRoleId: id('runtime-role'),
          instanceProfileId: id('runtime-identity'),
        })
    ) {
      throw new Error();
    }
  } catch {
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function assertNodeAuthority(authority) {
  const target = authority.target;
  if (
    target.resourceKey !== RESOURCE_KEY ||
    target.capability.kind !== 'resident-node' ||
    target.capability.version !== 1 ||
    target.role.kind !== 'node' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'direct' ||
    target.onDestroy !== 'purge' ||
    !sameJson(target.dependsOn, DIRECT_DEPENDENCY_KEYS) ||
    target.target.providerType !== PROVIDER_TYPE
  ) {
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
  const desiredDigest = getAwsSingleNodeNodeStateDigest(
    authority.providerSpec,
    nameAuthority(authority),
  );
  if (!sameJson(target.target.stateDigest, desiredDigest)) {
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
  const currentAction = authority.currentAction?.action ?? null;
  if (
    (authority.binding !== null && currentAction?.action === 'create') ||
    (authority.binding === null &&
      currentAction !== null &&
      currentAction.action !== 'create')
  ) {
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
  if (
    authority.binding !== null &&
    !AWS_EC2_INSTANCE_ID_PATTERN.test(authority.binding.providerResourceId)
  ) {
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
  const targets = createAwsSingleNodeDesiredResourceTargetCatalog({
    deploymentRevision: authority.deploymentRevision,
    profile: authority.profile,
    providerScope: authority.providerScope,
    providerSpec: authority.providerSpec,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
    head: authority.head,
  });
  const targetByKey = new Map(
    targets.map((/** @type {Readonly<Record<string, any>>} */ candidate) => [
      candidate.resourceKey,
      candidate,
    ]),
  );
  const bindings = new Map(
    authority.head.resourceBindings.map(
      (/** @type {Readonly<Record<string, any>>} */ binding) => [
        binding.resourceKey,
        binding,
      ],
    ),
  );
  const validated = new Set();
  /** @param {string} key @returns {void} */
  function validateClosure(key) {
    if (validated.has(key)) return;
    const definition = getAwsSingleNodeResourceDefinition(key);
    const dependencyTarget = targetByKey.get(key);
    const binding = bindings.get(key);
    if (
      definition === null ||
      dependencyTarget === undefined ||
      binding === undefined
    ) {
      throw new AwsSingleNodeNodeResourceObserverAuthorityError();
    }
    for (const dependencyKey of definition.dependsOn) {
      validateClosure(dependencyKey);
    }
    const dependencyBindings = definition.dependsOn
      .map((/** @type {string} */ dependencyKey) => {
        const dependency = bindings.get(dependencyKey);
        if (dependency === undefined) {
          throw new AwsSingleNodeNodeResourceObserverAuthorityError();
        }
        return {
          resourceKey: dependencyKey,
          bindingId: dependency.bindingId,
        };
      })
      .sort(
        (
          /** @type {{resourceKey: string}} */ left,
          /** @type {{resourceKey: string}} */ right,
        ) => compareCanonicalStrings(left.resourceKey, right.resourceKey),
      );
    if (
      binding.management !== dependencyTarget.management ||
      binding.deploymentInstanceId !== authority.deploymentInstanceId ||
      binding.incarnationId !== authority.incarnationId ||
      binding.providerScopeId !== authority.providerScope.providerScopeId ||
      binding.resourceKey !== key ||
      binding.providerType !== dependencyTarget.target.providerType ||
      !sameJson(binding.capability, dependencyTarget.capability) ||
      !sameJson(binding.role, dependencyTarget.role) ||
      binding.ownershipMode !== dependencyTarget.ownershipMode ||
      binding.onDestroy !== dependencyTarget.onDestroy ||
      !sameJson(binding.dependencyBindings, dependencyBindings) ||
      !planProvesBinding(authority, key, dependencyTarget, binding)
    ) {
      throw new AwsSingleNodeNodeResourceObserverAuthorityError();
    }
    validated.add(key);
  }
  const missingClosure = UPSTREAM_AUTHORITY_KEYS.filter(
    (key) => !bindings.has(key),
  );
  if (missingClosure.length !== 0) {
    for (const key of UPSTREAM_AUTHORITY_KEYS) {
      if (bindings.has(key)) validateClosure(key);
    }
    validateExistingDependencyProviderIds(authority, bindings);
    if (authority.binding !== null || currentAction?.action === 'create') {
      throw new AwsSingleNodeNodeResourceObserverAuthorityError();
    }
    return deepFreeze({
      ready: false,
      binding: authority.binding,
      currentAction,
      desiredDigest,
    });
  }
  for (const key of DIRECT_DEPENDENCY_KEYS) validateClosure(key);
  if (
    validated.size !== UPSTREAM_AUTHORITY_KEYS.length ||
    UPSTREAM_AUTHORITY_KEYS.some((key) => !validated.has(key))
  ) {
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
  validateSpecificDependencyProviderIds(authority, bindings);
  const profileName = getAwsSingleNodeRuntimeInstanceProfileName(
    nameAuthority(authority),
  );
  return deepFreeze({
    ready: true,
    binding: authority.binding,
    currentAction,
    desiredDigest,
    vpcId: bindings.get('network-vpc').providerResourceId,
    subnetId: bindings.get('network-subnet').providerResourceId,
    securityGroupId: bindings.get('network-security-group').providerResourceId,
    instanceProfileId: bindings.get('runtime-identity').providerResourceId,
    instanceProfileArn: `arn:${authority.providerScope.partition}:iam::${authority.providerScope.accountId}:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${profileName}`,
  });
}

/** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} target @returns {void} */
function assertHistoricalNodeAction(action, target) {
  if (
    action.resourceKey !== target.resourceKey ||
    !sameJson(action.capability, target.capability) ||
    !sameJson(action.role, target.role) ||
    action.management !== target.management ||
    action.ownershipMode !== target.ownershipMode ||
    action.onDestroy !== target.onDestroy ||
    !sameJson(action.dependsOn, target.dependsOn)
  ) {
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} operation @param {ReadonlySet<string>} allowedActions @returns {Readonly<Record<string, any>>} */
function receiptFromOperation(authority, plan, operation, allowedActions) {
  const binding = authority.binding;
  if (binding === null || operation.planId !== plan.planId) {
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
  const index = plan.actions.findIndex(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === RESOURCE_KEY,
  );
  const action = plan.actions[index];
  const intent = operation.intents[index];
  const state = action?.after;
  if (
    action === undefined ||
    intent === undefined ||
    !allowedActions.has(action.action) ||
    intent.actionId !== action.actionId ||
    intent.status !== 'settled' ||
    intent.ownershipNonce !== binding.ownershipNonce ||
    state === null ||
    state === undefined ||
    state.providerType !== PROVIDER_TYPE ||
    (state.providerResourceId !== null &&
      state.providerResourceId !== binding.providerResourceId)
  ) {
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
  assertHistoricalNodeAction(action, authority.target);
  if (
    state.stateDigest?.algorithm !== 'sha256' ||
    typeof state.stateDigest.value !== 'string' ||
    (action.action === 'create' &&
      binding.createdByActionId !== action.actionId)
  ) {
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
  return deepFreeze({
    createdByActionId: binding.createdByActionId,
    ownershipNonce: binding.ownershipNonce,
    stateDigest: state.stateDigest,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function historicalNodeReceipt(authority) {
  if (authority.binding === null) {
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
  const settledPlan = authority.settledPlan;
  const lastOperation = authority.head.lastOperation;
  if (settledPlan !== null || lastOperation !== null) {
    if (settledPlan === null || lastOperation === null) {
      throw new AwsSingleNodeNodeResourceObserverAuthorityError();
    }
    return receiptFromOperation(
      authority,
      settledPlan,
      lastOperation,
      new Set(['create', 'noop']),
    );
  }
  const activeOperation = authority.head.activeOperation;
  if (authority.plan === null || activeOperation === null) {
    throw new AwsSingleNodeNodeResourceObserverAuthorityError();
  }
  return receiptFromOperation(
    authority,
    authority.plan,
    activeOperation,
    new Set(['create']),
  );
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} dependencies @returns {Readonly<Record<string, any>>|null} */
function ownershipReceipt(authority, dependencies) {
  if (dependencies.binding !== null) {
    return historicalNodeReceipt(authority);
  }
  if (dependencies.currentAction?.action === 'create') {
    return deepFreeze({
      createdByActionId: dependencies.currentAction.actionId,
      ownershipNonce: authority.currentAction.ownershipNonce,
      stateDigest: dependencies.currentAction.after.stateDigest,
    });
  }
  return null;
}

/** @returns {Readonly<Record<string, any>>} */
function absentObservation() {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'absent',
    ownership: 'missing',
    providerIdentity: null,
    observedDigest: null,
    health: 'absent',
    execution: 'none',
  });
}

/** @param {'none'|'replay-safe-create'} [execution] @returns {Readonly<Record<string, any>>} */
function unknownObservation(execution = 'none') {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'unknown',
    ownership: 'unknown',
    providerIdentity: null,
    observedDigest: null,
    health: 'unknown',
    execution,
  });
}

/** @param {string} providerResourceId @param {Readonly<Record<string, any>>} digest @param {'starting'|'degraded'|'stopped'|'failed'} health @returns {Readonly<Record<string, any>>} */
function verifiedObservation(providerResourceId, digest, health) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'present',
    ownership: 'verified',
    providerIdentity: {
      providerType: PROVIDER_TYPE,
      providerResourceId,
    },
    observedDigest: digest,
    health,
    execution: 'none',
  });
}

/** @param {string} providerResourceId @returns {Readonly<Record<string, any>>} */
function conflictObservation(providerResourceId) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'present',
    ownership: 'conflict',
    providerIdentity: {
      providerType: PROVIDER_TYPE,
      providerResourceId,
    },
    observedDigest: null,
    health: 'unknown',
    execution: 'none',
  });
}

/**
 * Bind a strict read-only EC2 substrate observer to one exact credential
 * scope. The returned port exposes observation only.
 * @param {unknown} options - Exact four-method read client and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeNodeResourceObserver(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeNodeResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeNodeResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeNodeResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeNodeResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeNodeResourceObserver client',
  );
  for (const method of CLIENT_KEYS) {
    if (typeof options.client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeNodeResourceObserver client.${method} is required.`,
      );
    }
  }
  const client = Object.freeze(
    Object.fromEntries(
      [...CLIENT_KEYS].map((method) => [method, options.client[method]]),
    ),
  );
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeNodeResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_NODE_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 2 ||
    maxAttempts > AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeNodeResourceObserver maxAttempts must be an integer from 2 through ${AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeNodeResourceObserver waitForRetry must be a function.',
    );
  }

  /** @param {number} attempt @returns {Promise<boolean>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
      return true;
    } catch {
      return false;
    }
  }

  /** @param {string} instanceId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readExactInstance(instanceId) {
    let response;
    try {
      response = await client.describeInstances(
        deepFreeze({ InstanceIds: [instanceId] }),
      );
    } catch (error) {
      if (
        errorNamed(error, 'InvalidInstanceID.NotFound') ||
        errorNamed(error, 'InvalidInstanceId.NotFound')
      ) {
        return null;
      }
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    return decodeAwsSingleNodeNodeExactInstanceResponse(
      response,
      instanceId,
      providerScope,
    );
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<Readonly<Record<string, any>>>} */
  async function readInstanceDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeInstances(request);
    } catch {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    return decodeAwsSingleNodeNodeInstancePage(response, providerScope, false);
  }

  /** @param {string} volumeId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readExactRoot(volumeId) {
    let response;
    try {
      response = await client.describeVolumes(
        deepFreeze({ VolumeIds: [volumeId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidVolume.NotFound')) return null;
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    return decodeAwsSingleNodeNodeExactRootVolumeResponse(response, volumeId);
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<Readonly<Record<string, any>>>} */
  async function readRootDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeVolumes(request);
    } catch {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    return decodeAwsSingleNodeNodeRootVolumePage(response, false);
  }

  const instanceEvidence = createAwsTaggedEc2EvidenceKernel({
    baseTags: AWS_SINGLE_NODE_NODE_BASE_INSTANCE_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS,
    idKey: 'InstanceId',
    idPattern: AWS_EC2_INSTANCE_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES,
    maxTags: AWS_SINGLE_NODE_NODE_MAX_TAGS,
    readDiscoveryPage: readInstanceDiscoveryPage,
    readExact: readExactInstance,
  });
  const rootEvidence = createAwsTaggedEc2EvidenceKernel({
    baseTags: AWS_SINGLE_NODE_NODE_BASE_ROOT_VOLUME_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_NODE_ROOT_DISCOVERY_MAX_RESULTS,
    idKey: 'VolumeId',
    idPattern: AWS_SINGLE_NODE_NODE_VOLUME_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES,
    maxTags: AWS_SINGLE_NODE_NODE_MAX_TAGS,
    readDiscoveryPage: readRootDiscoveryPage,
    readExact: readExactRoot,
  });

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} receipt @returns {Readonly<Record<string, string>>} */
  function expectedTags(authority, receipt) {
    return instanceEvidence.ownershipTags({
      ...locator(authority),
      createdByActionId: receipt.createdByActionId,
      ownershipNonce: receipt.ownershipNonce,
      stateDigestValue: receipt.stateDigest.value,
    });
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} instance @returns {{receipt: Readonly<Record<string, any>>, lifecycle: string}} */
  function destroyedResourceReceipt(authority, instance) {
    const destroyedResourceLocator = authority.destroyedResourceLocator;
    const providerState = destroyedResourceLocator?.providerState;
    const desiredStateDigest = authority.target.target.stateDigest;
    if (
      destroyedResourceLocator === null ||
      destroyedResourceLocator === undefined ||
      providerState?.providerType !== PROVIDER_TYPE ||
      providerState.providerResourceId !== instance.InstanceId ||
      providerState.stateDigest?.algorithm !== 'sha256' ||
      typeof providerState.stateDigest.value !== 'string' ||
      desiredStateDigest?.algorithm !== 'sha256' ||
      typeof desiredStateDigest.value !== 'string' ||
      typeof destroyedResourceLocator.ownershipNonce !== 'string'
    ) {
      throw new AwsSingleNodeNodeResourceObserverAuthorityError();
    }
    const createdByActionId = exactTagValue(
      instance.Tags,
      'wharfie:created-by-action-id',
    );
    try {
      assertDeploymentActionId(
        createdByActionId,
        'awsSingleNodeNode destroyed createdByActionId',
      );
    } catch {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    const receipt = deepFreeze({
      createdByActionId,
      ownershipNonce: destroyedResourceLocator.ownershipNonce,
      stateDigest: desiredStateDigest,
    });
    const identity = decodeAwsSingleNodeNodeIdentityEvidence(instance, {
      providerScopeAccountId: providerScope.accountId,
      expectedClientToken: getAwsSingleNodeNodeCreateClientToken(
        receipt.createdByActionId,
        receipt.ownershipNonce,
      ),
      expectedInstanceId: providerState.providerResourceId,
      expectedTags: expectedTags(authority, receipt),
      allowTagPropagation: false,
    });
    return { receipt, lifecycle: identity.lifecycle };
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>|null} receipt @param {Readonly<Record<string, any>>} dependencies @param {string|null} [allowedCollisionProviderResourceId] @returns {Promise<Readonly<Record<string, any>>[]>} */
  async function discoverInstances(
    authority,
    receipt,
    dependencies,
    allowedCollisionProviderResourceId = null,
  ) {
    const records = new Map();
    const seenTokens = new Set();
    const filters = instanceEvidence.discoveryFilters(locator(authority));
    let nextToken = null;
    for (
      let page = 1;
      page <= AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES;
      page += 1
    ) {
      const observed = await readInstanceDiscoveryPage(
        deepFreeze({
          Filters: filters,
          MaxResults: AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS,
          ...(nextToken === null ? {} : { NextToken: nextToken }),
        }),
      );
      for (const record of observed.records) {
        if (records.has(record.InstanceId)) {
          throw new NodeCandidateConflictError(record.InstanceId);
        }
        records.set(record.InstanceId, record);
      }
      if (records.size > 1) {
        const conflictingProviderResourceId =
          [...records.keys()]
            .sort(compareCanonicalStrings)
            .find(
              (providerResourceId) =>
                providerResourceId !== allowedCollisionProviderResourceId,
            ) ?? [...records.keys()].sort(compareCanonicalStrings)[0];
        throw new NodeCandidateConflictError(conflictingProviderResourceId);
      }
      for (const record of observed.records) {
        try {
          if (receipt === null) {
            instanceEvidence.validateCollisionTags(
              record.Tags,
              instanceEvidence.locatorTags(locator(authority)),
            );
          } else {
            decodeAwsSingleNodeNodeIdentityEvidence(record, {
              providerScopeAccountId: providerScope.accountId,
              expectedClientToken: getAwsSingleNodeNodeCreateClientToken(
                receipt.createdByActionId,
                receipt.ownershipNonce,
              ),
              expectedInstanceId:
                dependencies.binding?.providerResourceId ?? null,
              expectedTags: expectedTags(authority, receipt),
              allowTagPropagation:
                dependencies.binding === null &&
                dependencies.currentAction?.action === 'create',
            });
          }
        } catch (error) {
          if (
            error instanceof AwsSingleNodeNodeEvidenceConflictError ||
            error instanceof AwsTaggedEc2EvidenceConflictError
          ) {
            throw new NodeCandidateConflictError(record.InstanceId);
          }
          throw error;
        }
        if (receipt === null && allowedCollisionProviderResourceId === null) {
          return [...records.values()];
        }
      }
      if (observed.nextToken === null) break;
      if (
        page === AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new AwsSingleNodeNodeEvidenceUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    return [...records.values()];
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} dependencies @param {Readonly<Record<string, any>>|null} receipt @returns {Promise<{kind: 'absent'}|{kind: 'conflict', providerResourceId: string}|{kind: 'present', instance: Readonly<Record<string, any>>, lifecycle: string}>} */
  async function readInstanceViews(authority, dependencies, receipt) {
    if (dependencies.binding !== null) {
      if (receipt === null) {
        throw new AwsSingleNodeNodeResourceObserverAuthorityError();
      }
      const exactId = dependencies.binding.providerResourceId;
      try {
        const exact = await instanceEvidence.readExactSafely(exactId);
        if (exact === null) {
          if (dependencies.currentAction?.action !== 'delete') {
            throw new AwsSingleNodeNodeEvidenceTransientError();
          }
          const discovered = await discoverInstances(
            authority,
            receipt,
            dependencies,
          );
          if (discovered.length === 0) return { kind: 'absent' };
          throw new AwsSingleNodeNodeEvidenceTransientError();
        }
        const identity = decodeAwsSingleNodeNodeIdentityEvidence(exact, {
          providerScopeAccountId: providerScope.accountId,
          expectedClientToken: getAwsSingleNodeNodeCreateClientToken(
            receipt.createdByActionId,
            receipt.ownershipNonce,
          ),
          expectedInstanceId: exactId,
          expectedTags: expectedTags(authority, receipt),
          allowTagPropagation: false,
        });
        return {
          kind: 'present',
          instance: exact,
          lifecycle: identity.lifecycle,
        };
      } catch (error) {
        if (error instanceof NodeCandidateConflictError) {
          return {
            kind: 'conflict',
            providerResourceId: error.providerResourceId,
          };
        }
        if (
          error instanceof AwsSingleNodeNodeEvidenceConflictError ||
          error instanceof AwsTaggedEc2EvidenceConflictError
        ) {
          return { kind: 'conflict', providerResourceId: exactId };
        }
        throw error;
      }
    }
    let discovered;
    try {
      discovered = await discoverInstances(authority, receipt, dependencies);
    } catch (error) {
      if (error instanceof NodeCandidateConflictError) {
        return {
          kind: 'conflict',
          providerResourceId: error.providerResourceId,
        };
      }
      throw error;
    }
    if (discovered.length === 0) return { kind: 'absent' };
    if (receipt === null || discovered.length > 1) {
      return {
        kind: 'conflict',
        providerResourceId: [...discovered]
          .map((record) => record.InstanceId)
          .sort()[0],
      };
    }
    const discoveredRecord = discovered[0];
    const exactId = discoveredRecord.InstanceId;
    try {
      const exact = await instanceEvidence.readExactSafely(exactId);
      const tags = expectedTags(authority, receipt);
      const token = getAwsSingleNodeNodeCreateClientToken(
        receipt.createdByActionId,
        receipt.ownershipNonce,
      );
      /** @type {Readonly<Record<string, any>>|null} */
      let discoveredIdentity = null;
      if (discoveredRecord !== null) {
        discoveredIdentity = decodeAwsSingleNodeNodeIdentityEvidence(
          discoveredRecord,
          {
            providerScopeAccountId: providerScope.accountId,
            expectedClientToken: token,
            expectedInstanceId:
              dependencies.binding?.providerResourceId ?? null,
            expectedTags: tags,
            allowTagPropagation:
              dependencies.binding === null &&
              dependencies.currentAction?.action === 'create',
          },
        );
      }
      /** @type {Readonly<Record<string, any>>|null} */
      const exactIdentity =
        exact === null
          ? null
          : decodeAwsSingleNodeNodeIdentityEvidence(exact, {
              providerScopeAccountId: providerScope.accountId,
              expectedClientToken: token,
              expectedInstanceId:
                dependencies.binding?.providerResourceId ?? null,
              expectedTags: tags,
              allowTagPropagation:
                dependencies.binding === null &&
                dependencies.currentAction?.action === 'create',
            });
      if (exactIdentity === null || discoveredIdentity === null) {
        throw new AwsSingleNodeNodeEvidenceTransientError();
      }
      if (
        discoveredIdentity.providerResourceId !==
          exactIdentity.providerResourceId ||
        discoveredIdentity.lifecycle !== exactIdentity.lifecycle
      ) {
        throw new AwsSingleNodeNodeEvidenceTransientError();
      }
      return {
        kind: 'present',
        instance: exact,
        lifecycle: exactIdentity.lifecycle,
      };
    } catch (error) {
      if (
        error instanceof AwsSingleNodeNodeEvidenceConflictError ||
        error instanceof AwsTaggedEc2EvidenceConflictError
      ) {
        return { kind: 'conflict', providerResourceId: exactId };
      }
      throw error;
    }
  }

  /** @param {string} instanceId @param {string} attribute @returns {Promise<unknown>} */
  async function readAttribute(instanceId, attribute) {
    try {
      return await client.describeInstanceAttribute(
        deepFreeze({ InstanceId: instanceId, Attribute: attribute }),
      );
    } catch (error) {
      if (
        errorNamed(error, 'InvalidInstanceID.NotFound') ||
        errorNamed(error, 'InvalidInstanceId.NotFound')
      ) {
        throw new AwsSingleNodeNodeEvidenceTransientError();
      }
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
  }

  /** @param {string} instanceId @returns {Promise<unknown>} */
  async function readCredits(instanceId) {
    try {
      return await client.describeInstanceCreditSpecifications(
        deepFreeze({ InstanceIds: [instanceId] }),
      );
    } catch (error) {
      if (
        errorNamed(error, 'InvalidInstanceID.NotFound') ||
        errorNamed(error, 'InvalidInstanceId.NotFound')
      ) {
        throw new AwsSingleNodeNodeEvidenceTransientError();
      }
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
  }

  /** @param {unknown[]} errors @returns {never} */
  function throwStrongestEvidence(errors) {
    if (
      errors.some(
        (error) =>
          error instanceof AwsSingleNodeNodeEvidenceConflictError ||
          error instanceof AwsTaggedEc2EvidenceConflictError,
      )
    ) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    if (
      errors.some(
        (error) =>
          error instanceof AwsSingleNodeNodeEvidenceUnknownError ||
          error instanceof AwsTaggedEc2EvidenceUnknownError,
      )
    ) {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    throw new AwsSingleNodeNodeEvidenceTransientError();
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>|null} receipt @param {string|null} [allowedCollisionProviderResourceId] @returns {Promise<Readonly<Record<string, any>>[]>} */
  async function discoverRoots(
    authority,
    receipt,
    allowedCollisionProviderResourceId = null,
  ) {
    const records = new Map();
    const seenTokens = new Set();
    const filters = rootEvidence.discoveryFilters(locator(authority));
    const tags =
      receipt === null
        ? null
        : getAwsSingleNodeNodeRootVolumeTags(expectedTags(authority, receipt));
    let nextToken = null;
    for (
      let page = 1;
      page <= AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES;
      page += 1
    ) {
      const observed = await readRootDiscoveryPage(
        deepFreeze({
          Filters: filters,
          MaxResults: AWS_SINGLE_NODE_NODE_ROOT_DISCOVERY_MAX_RESULTS,
          ...(nextToken === null ? {} : { NextToken: nextToken }),
        }),
      );
      for (const record of observed.records) {
        if (records.has(record.VolumeId)) {
          throw new AwsSingleNodeNodeEvidenceConflictError();
        }
        records.set(record.VolumeId, record);
      }
      if (records.size > 1) {
        throw new AwsSingleNodeNodeEvidenceConflictError();
      }
      for (const record of observed.records) {
        if (tags === null) {
          rootEvidence.validateCollisionTags(
            record.Tags,
            rootEvidence.locatorTags(locator(authority)),
          );
        } else {
          validateAwsSingleNodeNodeManagedTags(record.Tags, tags, false);
        }
        if (receipt === null && allowedCollisionProviderResourceId === null) {
          return [...records.values()];
        }
      }
      if (observed.nextToken === null) break;
      if (
        page === AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new AwsSingleNodeNodeEvidenceUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    return [...records.values()];
  }

  /**
   * An exact historical ID miss is not enough: a replacement node or root can
   * still exist under the stable deployment locator. Drain both collision-only
   * reads before ranking any candidate above an incomplete provider read.
   * @param {Readonly<Record<string, any>>} authority - Completed destroy read authority.
   * @param {string} historicalInstanceId - Exact instance ID from destroy lineage.
   * @returns {Promise<string|null>} Contradictory provider identity, if any.
   */
  async function destroyedCollisionProviderResourceId(
    authority,
    historicalInstanceId,
  ) {
    const [instanceResult, rootResult] = await Promise.allSettled([
      discoverInstances(authority, null, {
        binding: null,
        currentAction: null,
      }),
      discoverRoots(authority, null),
    ]);
    if (instanceResult.status === 'fulfilled') {
      const candidate = instanceResult.value[0];
      if (candidate !== undefined) return candidate.InstanceId;
    } else if (instanceResult.reason instanceof NodeCandidateConflictError) {
      return instanceResult.reason.providerResourceId;
    }
    if (rootResult.status === 'fulfilled' && rootResult.value.length !== 0) {
      return historicalInstanceId;
    }
    const errors = [instanceResult, rootResult]
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (
      errors.some(
        (error) =>
          error instanceof AwsSingleNodeNodeEvidenceConflictError ||
          error instanceof AwsTaggedEc2EvidenceConflictError,
      )
    ) {
      return historicalInstanceId;
    }
    if (errors.length !== 0) throwStrongestEvidence(errors);
    return null;
  }

  /** @param {Readonly<Record<string, any>>} authority @param {string} historicalInstanceId @param {string|null} historicalRootVolumeId @returns {Promise<string|null>} */
  async function destroyedTerminalCollisionProviderResourceId(
    authority,
    historicalInstanceId,
    historicalRootVolumeId,
  ) {
    const [instanceResult, rootResult] = await Promise.allSettled([
      discoverInstances(
        authority,
        null,
        { binding: null, currentAction: null },
        historicalInstanceId,
      ),
      discoverRoots(authority, null, historicalRootVolumeId),
    ]);
    if (instanceResult.status === 'fulfilled') {
      const collision = instanceResult.value.find(
        (record) => record.InstanceId !== historicalInstanceId,
      );
      if (collision !== undefined) return collision.InstanceId;
    } else if (instanceResult.reason instanceof NodeCandidateConflictError) {
      return instanceResult.reason.providerResourceId;
    }
    if (
      rootResult.status === 'fulfilled' &&
      rootResult.value.some(
        (record) => record.VolumeId !== historicalRootVolumeId,
      )
    ) {
      return historicalInstanceId;
    }
    const errors = [instanceResult, rootResult]
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (
      errors.some(
        (error) =>
          error instanceof AwsSingleNodeNodeEvidenceConflictError ||
          error instanceof AwsTaggedEc2EvidenceConflictError,
      )
    ) {
      return historicalInstanceId;
    }
    if (errors.length !== 0) throwStrongestEvidence(errors);
    return null;
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} receipt @param {string} rootVolumeId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readRootViews(authority, receipt, rootVolumeId) {
    const exact = await rootEvidence.readExactSafely(rootVolumeId);
    if (exact === null) return null;
    const tags = getAwsSingleNodeNodeRootVolumeTags(
      expectedTags(authority, receipt),
    );
    validateAwsSingleNodeNodeManagedTags(exact.Tags, tags, false);
    return exact;
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} dependencies @param {Readonly<Record<string, any>>} receipt @param {Readonly<Record<string, any>>} instance @param {string} lifecycle @returns {Promise<Readonly<Record<string, any>>>} */
  async function readCompleteObservation(
    authority,
    dependencies,
    receipt,
    instance,
    lifecycle,
  ) {
    const instanceId = instance.InstanceId;
    let rootRead;
    try {
      const rootVolumeId = decodeAwsSingleNodeNodeTerminalRootVolumeId(
        instance.BlockDeviceMappings,
        authority.providerSpec.node.rootVolume.deviceName,
      );
      if (rootVolumeId === null) {
        throw new AwsSingleNodeNodeEvidenceUnknownError();
      }
      rootRead = readRootViews(authority, receipt, rootVolumeId);
    } catch (error) {
      rootRead = Promise.reject(error);
    }
    const results = await Promise.allSettled([
      Promise.resolve().then(() =>
        decodeAwsSingleNodeNodeInstanceState(instance, {
          providerSpec: authority.providerSpec,
          providerScopeAccountId: providerScope.accountId,
          vpcId: dependencies.vpcId,
          subnetId: dependencies.subnetId,
          securityGroupId: dependencies.securityGroupId,
          instanceProfileId: dependencies.instanceProfileId,
          instanceProfileArn: dependencies.instanceProfileArn,
        }),
      ),
      readAttribute(instanceId, 'userData'),
      readAttribute(instanceId, 'disableApiTermination'),
      readAttribute(instanceId, 'disableApiStop'),
      readAttribute(instanceId, 'instanceInitiatedShutdownBehavior'),
      readCredits(instanceId),
      rootRead,
    ]);
    /** @type {unknown[]} */
    const errors = [];
    for (const result of results) {
      if (result.status === 'rejected') errors.push(result.reason);
    }
    /** @type {Record<string, any>} */
    const decodedAttributes = {};
    const decoded = results[0].status === 'fulfilled' ? results[0].value : null;
    let cpuCredits = null;
    let rootVolume = null;
    const attributeNames = [
      'userData',
      'disableApiTermination',
      'disableApiStop',
      'instanceInitiatedShutdownBehavior',
    ];
    for (let index = 0; index < attributeNames.length; index += 1) {
      const result = results[index + 1];
      if (result.status !== 'fulfilled') continue;
      try {
        decodedAttributes[attributeNames[index]] =
          decodeAwsSingleNodeNodeInstanceAttribute(
            result.value,
            instanceId,
            attributeNames[index],
          );
      } catch (error) {
        errors.push(error);
      }
    }
    if (results[5].status === 'fulfilled') {
      try {
        cpuCredits = decodeAwsSingleNodeNodeCreditSpecification(
          results[5].value,
          instanceId,
        );
      } catch (error) {
        errors.push(error);
      }
    }
    if (results[6].status === 'fulfilled') {
      try {
        if (results[6].value === null) {
          throw new AwsSingleNodeNodeEvidenceTransientError();
        }
        rootVolume = decodeAwsSingleNodeNodeRootVolumeState(results[6].value, {
          providerSpec: authority.providerSpec,
          expectedTags: getAwsSingleNodeNodeRootVolumeTags(
            expectedTags(authority, receipt),
          ),
          allowTagPropagation: false,
          instanceId,
        });
      } catch (error) {
        errors.push(error);
      }
    }
    const attributes =
      Object.keys(decodedAttributes).length === attributeNames.length
        ? decodedAttributes
        : null;
    if (
      errors.length !== 0 ||
      decoded === null ||
      attributes === null ||
      cpuCredits === null ||
      rootVolume === null
    ) {
      throwStrongestEvidence(errors);
    }
    const observedDigest = getAwsSingleNodeNodeObservedStateDigest(
      authority.providerSpec,
      nameAuthority(authority),
      createAwsSingleNodeNodeReadableState(
        decoded.readableState,
        attributes,
        cpuCredits,
        rootVolume,
      ),
    );
    return verifiedObservation(
      instanceId,
      observedDigest,
      getAwsSingleNodeNodeLifecycleHealth(lifecycle),
    );
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} receipt @param {Readonly<Record<string, any>>|null} terminalInstance @param {string} instanceId @returns {Promise<{status: 'absent'|'negative'|'not-converged', signature: string|null}>} */
  async function readDeleteAbsence(
    authority,
    receipt,
    terminalInstance,
    instanceId,
  ) {
    const rootVolumeId =
      terminalInstance === null
        ? null
        : decodeAwsSingleNodeNodeTerminalRootVolumeId(
            terminalInstance.BlockDeviceMappings,
            authority.providerSpec.node.rootVolume.deviceName,
          );
    const tags = getAwsSingleNodeNodeRootVolumeTags(
      expectedTags(authority, receipt),
    );
    if (rootVolumeId !== null) {
      const exact = await rootEvidence.readExactSafely(rootVolumeId);
      if (exact === null) {
        const discovered = await discoverRoots(authority, receipt);
        if (discovered.length === 0) {
          return { status: 'absent', signature: null };
        }
        if (discovered.length > 1 || discovered[0].VolumeId !== rootVolumeId) {
          throw new AwsSingleNodeNodeEvidenceConflictError();
        }
        throw new AwsSingleNodeNodeEvidenceTransientError();
      }
      validateAwsSingleNodeNodeManagedTags(exact.Tags, tags, false);
      const state = decodeAwsSingleNodeNodeRootVolumePurgeEvidence(exact, {
        providerSpec: authority.providerSpec,
        expectedTags: tags,
        instanceId,
      });
      return {
        status: state === 'deleted' ? 'absent' : 'not-converged',
        signature: null,
      };
    }
    const discovered = await discoverRoots(authority, receipt);
    if (discovered.length > 1) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    const discoveredRoot = discovered[0] ?? null;
    if (discoveredRoot === null) {
      if (terminalInstance !== null) {
        return { status: 'absent', signature: null };
      }
      return {
        status: 'negative',
        signature: JSON.stringify({
          instance:
            terminalInstance === null
              ? 'typed-absent'
              : 'terminated-without-root-id',
          instanceLocator: [],
          rootLocator: [],
        }),
      };
    }
    const exact = await rootEvidence.readExactSafely(discoveredRoot.VolumeId);
    if (exact === null) {
      throw new AwsSingleNodeNodeEvidenceTransientError();
    }
    const state = decodeAwsSingleNodeNodeRootVolumePurgeEvidence(exact, {
      providerSpec: authority.providerSpec,
      expectedTags: tags,
      instanceId,
    });
    return {
      status: state === 'deleted' ? 'absent' : 'not-converged',
      signature: null,
    };
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>>} */
  async function observeDestroyedResource(authority) {
    const destroyedResourceLocator = authority.destroyedResourceLocator;
    const instanceId =
      destroyedResourceLocator?.providerState?.providerResourceId;
    if (
      destroyedResourceLocator?.resourceKey !== RESOURCE_KEY ||
      destroyedResourceLocator.providerState?.providerType !== PROVIDER_TYPE ||
      typeof instanceId !== 'string' ||
      !AWS_EC2_INSTANCE_ID_PATTERN.test(instanceId)
    ) {
      throw new AwsSingleNodeNodeResourceObserverAuthorityError();
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const exact = await instanceEvidence.readExactSafely(instanceId);
        if (exact === null) {
          const collisionProviderResourceId =
            await destroyedCollisionProviderResourceId(authority, instanceId);
          if (collisionProviderResourceId !== null) {
            return conflictObservation(collisionProviderResourceId);
          }
          if (attempt === maxAttempts) return absentObservation();
        } else {
          const { receipt, lifecycle } = destroyedResourceReceipt(
            authority,
            exact,
          );
          if (lifecycle === 'terminated') {
            const historicalRootVolumeId =
              decodeAwsSingleNodeNodeTerminalRootVolumeId(
                exact.BlockDeviceMappings,
                authority.providerSpec.node.rootVolume.deviceName,
              );
            const absence = await readDeleteAbsence(
              authority,
              receipt,
              exact,
              instanceId,
            );
            if (absence.status === 'absent') {
              const collisionProviderResourceId =
                await destroyedTerminalCollisionProviderResourceId(
                  authority,
                  instanceId,
                  historicalRootVolumeId,
                );
              return collisionProviderResourceId === null
                ? absentObservation()
                : conflictObservation(collisionProviderResourceId);
            }
            throw new AwsSingleNodeNodeEvidenceTransientError();
          }
          if (lifecycle === 'shutting-down') {
            throw new AwsSingleNodeNodeEvidenceTransientError();
          }
          return conflictObservation(instanceId);
        }
      } catch (error) {
        if (
          error instanceof AwsSingleNodeNodeEvidenceConflictError ||
          error instanceof AwsTaggedEc2EvidenceConflictError
        ) {
          return conflictObservation(instanceId);
        }
        if (
          !(error instanceof AwsSingleNodeNodeEvidenceUnknownError) &&
          !(error instanceof AwsSingleNodeNodeEvidenceTransientError) &&
          !(error instanceof AwsTaggedEc2EvidenceUnknownError) &&
          !(error instanceof AwsTaggedEc2EvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) return unknownObservation();
      }
      if (attempt < maxAttempts && !(await wait(attempt))) {
        return unknownObservation();
      }
    }
    return unknownObservation();
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeNodeResourceObserverAuthorityError();
    }
    if (authority.destroyedResourceLocator !== undefined) {
      return observeDestroyedResource(authority);
    }
    const dependencies = assertNodeAuthority(authority);
    if (dependencies.ready === false) return unknownObservation();
    const receipt = ownershipReceipt(authority, dependencies);
    const currentCreate =
      dependencies.binding === null &&
      dependencies.currentAction?.action === 'create';
    const unboundIdle =
      dependencies.binding === null && dependencies.currentAction === null;
    const deleting =
      dependencies.binding !== null &&
      dependencies.currentAction?.action === 'delete';
    /** @type {string[]} */
    const negativeSignatures = [];
    let cleanHistory = true;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const views = await readInstanceViews(authority, dependencies, receipt);
        if (views.kind === 'conflict') {
          return conflictObservation(views.providerResourceId);
        }
        if (views.kind === 'absent') {
          if (deleting) {
            if (receipt === null) {
              throw new AwsSingleNodeNodeResourceObserverAuthorityError();
            }
            const absence = await readDeleteAbsence(
              authority,
              receipt,
              null,
              dependencies.binding.providerResourceId,
            );
            if (absence.status === 'absent') return absentObservation();
            if (absence.status === 'negative' && absence.signature !== null) {
              negativeSignatures.push(absence.signature);
              if (
                attempt === maxAttempts &&
                negativeSignatures.length === maxAttempts &&
                negativeSignatures.every(
                  (signature) => signature === negativeSignatures[0],
                )
              ) {
                return absentObservation();
              }
            } else {
              cleanHistory = false;
              throw new AwsSingleNodeNodeEvidenceTransientError();
            }
          } else if (!currentCreate && !unboundIdle) {
            cleanHistory = false;
          }
          if (attempt === maxAttempts) {
            if (currentCreate && cleanHistory) {
              return unknownObservation('replay-safe-create');
            }
            if (unboundIdle && cleanHistory) return absentObservation();
            return unknownObservation();
          }
        } else {
          cleanHistory = false;
          if (receipt === null) {
            throw new AwsSingleNodeNodeResourceObserverAuthorityError();
          }
          if (deleting && views.lifecycle === 'terminated') {
            const absence = await readDeleteAbsence(
              authority,
              receipt,
              views.instance,
              dependencies.binding.providerResourceId,
            );
            if (absence.status === 'absent') return absentObservation();
            if (absence.status === 'negative' && absence.signature !== null) {
              negativeSignatures.push(absence.signature);
              if (
                attempt === maxAttempts &&
                negativeSignatures.length === maxAttempts &&
                negativeSignatures.every(
                  (signature) => signature === negativeSignatures[0],
                )
              ) {
                return absentObservation();
              }
            }
            throw new AwsSingleNodeNodeEvidenceTransientError();
          }
          if (deleting && views.lifecycle === 'shutting-down') {
            throw new AwsSingleNodeNodeEvidenceTransientError();
          }
          try {
            return await readCompleteObservation(
              authority,
              dependencies,
              receipt,
              views.instance,
              views.lifecycle,
            );
          } catch (error) {
            if (
              error instanceof AwsSingleNodeNodeEvidenceConflictError ||
              error instanceof AwsTaggedEc2EvidenceConflictError
            ) {
              return conflictObservation(views.instance.InstanceId);
            }
            throw error;
          }
        }
      } catch (error) {
        cleanHistory = false;
        if (
          error instanceof AwsSingleNodeNodeEvidenceConflictError ||
          error instanceof AwsTaggedEc2EvidenceConflictError
        ) {
          if (dependencies.binding !== null) {
            return conflictObservation(dependencies.binding.providerResourceId);
          }
          return unknownObservation();
        }
        if (
          !(error instanceof AwsSingleNodeNodeEvidenceUnknownError) &&
          !(error instanceof AwsSingleNodeNodeEvidenceTransientError) &&
          !(error instanceof AwsTaggedEc2EvidenceUnknownError) &&
          !(error instanceof AwsTaggedEc2EvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) return unknownObservation();
      }
      if (attempt < maxAttempts && !(await wait(attempt))) {
        return unknownObservation();
      }
    }
    return unknownObservation();
  }

  return Object.freeze({ observe });
}

export default {
  AWS_SINGLE_NODE_NODE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES,
  AwsSingleNodeNodeResourceObserverAuthorityError,
  createAwsSingleNodeNodeResourceObserver,
};
