/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable post-destroy authority contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from './deployment-aws-default-ipv4-route-resource.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from './deployment-aws-internet-gateway-attachment-resource.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import {
  assertAwsEc2InstanceId,
  assertAwsIamInstanceProfileId,
  assertAwsIamRoleId,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
} from './deployment-aws-runtime-identity-contract.js';
import { getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId } from './deployment-aws-subnet-route-table-association-resource.js';
import { getAwsSingleNodeVolumeAttachmentProviderResourceId } from './deployment-aws-volume-attachment-resource.js';
import {
  assertDeploymentActionId,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import {
  getAwsSingleNodeResourceApplyOrder,
  getAwsSingleNodeResourceDefinition,
} from './deployment-resource-graph.js';

const AUTHORITY_KEYS = new Set([
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
const VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/;
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const INTERNET_GATEWAY_ID_PATTERN = /^igw-[0-9a-f]{8,32}$/;
const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,32}$/;
const ROUTE_TABLE_ID_PATTERN = /^rtb-[0-9a-f]{8,32}$/;
const SECURITY_GROUP_ID_PATTERN = /^sg-[0-9a-f]{8,32}$/;
const AUTHORITY_ERROR =
  'AWS single-node destroyed-resource locator does not match exact completed destroy-plan authority.';

/** Exact completed destroy lineage cannot authorize a historical provider locator. */
export class AwsSingleNodeDestroyedResourceLocatorAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'AwsSingleNodeDestroyedResourceLocatorAuthorityError';
    this.code = 'AWS_SINGLE_NODE_DESTROYED_RESOURCE_LOCATOR_AUTHORITY';
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

/** @param {Record<string, any>} value @param {Set<string>} keys @returns {void} */
function assertExactKeys(value, keys) {
  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== 'string' || !keys.has(key),
    ) ||
    [...keys].some((key) => !Object.hasOwn(value, key))
  ) {
    throw new AwsSingleNodeDestroyedResourceLocatorAuthorityError();
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

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function canonicalAuthority(value) {
  if (!isPlainObject(value)) {
    throw new AwsSingleNodeDestroyedResourceLocatorAuthorityError();
  }
  assertExactKeys(value, AUTHORITY_KEYS);
  let canonical;
  try {
    canonical = createAwsSingleNodeResourceObservationAuthority({
      operation: value.operation,
      deploymentRevision: value.deploymentRevision,
      profile: value.profile,
      providerScope: value.providerScope,
      providerSpec: value.providerSpec,
      deploymentInstanceId: value.deploymentInstanceId,
      incarnationId: value.incarnationId,
      head: value.head,
      plan: value.plan,
      settledPlan: value.settledPlan,
      target: value.target,
    });
  } catch {
    throw new AwsSingleNodeDestroyedResourceLocatorAuthorityError();
  }
  if (
    !sameJson(value.binding, canonical.binding) ||
    !sameJson(value.currentAction, canonical.currentAction)
  ) {
    throw new AwsSingleNodeDestroyedResourceLocatorAuthorityError();
  }
  return canonical;
}

/** @param {Readonly<Record<string, any>>} authority @returns {{plan: Readonly<Record<string, any>>, operation: Readonly<Record<string, any>>}|null} */
function completedDestroyLineage(authority) {
  const head = authority.head;
  if (head.phase === 'DESTROYED') {
    if (
      authority.plan !== null ||
      authority.settledPlan?.operation !== 'destroy' ||
      head.lastOperation?.kind !== 'destroy' ||
      head.lastOperation.planId !== authority.settledPlan.planId
    ) {
      throw new AwsSingleNodeDestroyedResourceLocatorAuthorityError();
    }
    return { plan: authority.settledPlan, operation: head.lastOperation };
  }
  if (
    head.phase !== 'DESTROYING' ||
    authority.plan?.operation !== 'destroy' ||
    head.activeOperation?.kind !== 'destroy' ||
    head.activeOperation.planId !== authority.plan.planId ||
    head.activeOperation.nextActionIndex !== authority.plan.actions.length ||
    head.activeOperation.intents.length !== authority.plan.actions.length ||
    head.activeOperation.intents.some(
      (/** @type {Readonly<Record<string, any>>} */ intent) =>
        intent.status !== 'settled',
    )
  ) {
    return null;
  }
  return { plan: authority.plan, operation: head.activeOperation };
}

/** @param {string} resourceKey @param {Map<string, Readonly<Record<string, any>>>} stateByKey @param {Readonly<Record<string, any>>} authority @returns {string} */
function expectedProviderResourceId(resourceKey, stateByKey, authority) {
  /** @param {string} key @returns {string} */
  function id(key) {
    const state = stateByKey.get(key);
    if (state === undefined) {
      throw new AwsSingleNodeDestroyedResourceLocatorAuthorityError();
    }
    return state.providerResourceId;
  }

  if (resourceKey === 'artifact') {
    return getAwsSingleNodeManagedArtifactObjectLocation({
      providerScope: authority.providerScope,
      deploymentInstanceId: authority.deploymentInstanceId,
      incarnationId: authority.incarnationId,
    }).arn;
  }
  if (resourceKey === 'application-state') {
    if (!VOLUME_ID_PATTERN.test(id(resourceKey))) throw new Error();
    return id(resourceKey);
  }
  if (resourceKey === 'control-state') {
    if (!VOLUME_ID_PATTERN.test(id(resourceKey))) throw new Error();
    return id(resourceKey);
  }
  if (resourceKey === 'network-vpc') {
    if (!VPC_ID_PATTERN.test(id(resourceKey))) throw new Error();
    return id(resourceKey);
  }
  if (resourceKey === 'network-internet-gateway') {
    if (!INTERNET_GATEWAY_ID_PATTERN.test(id(resourceKey))) throw new Error();
    return id(resourceKey);
  }
  if (resourceKey === 'network-internet-gateway-attachment') {
    return getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
      id('network-internet-gateway'),
      id('network-vpc'),
    );
  }
  if (resourceKey === 'network-subnet') {
    if (!SUBNET_ID_PATTERN.test(id(resourceKey))) throw new Error();
    return id(resourceKey);
  }
  if (resourceKey === 'network-route-table') {
    if (!ROUTE_TABLE_ID_PATTERN.test(id(resourceKey))) throw new Error();
    return id(resourceKey);
  }
  if (resourceKey === 'network-default-ipv4-route') {
    return getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
      authority.providerSpec.capabilities.networking.egressCidr,
      id('network-internet-gateway'),
      id('network-route-table'),
    );
  }
  if (resourceKey === 'network-subnet-route-table-association') {
    return getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId(
      id('network-route-table'),
      id('network-subnet'),
    );
  }
  if (resourceKey === 'network-security-group') {
    if (!SECURITY_GROUP_ID_PATTERN.test(id(resourceKey))) throw new Error();
    return id(resourceKey);
  }
  if (resourceKey === 'runtime-role') {
    assertAwsIamRoleId(id(resourceKey));
    return id(resourceKey);
  }
  if (resourceKey === 'runtime-role-policy') {
    return getAwsSingleNodeRuntimePolicyProviderResourceId({
      runtimeRoleId: id('runtime-role'),
    });
  }
  if (resourceKey === 'runtime-identity') {
    assertAwsIamInstanceProfileId(id(resourceKey));
    return id(resourceKey);
  }
  if (resourceKey === 'runtime-identity-role-association') {
    return getAwsSingleNodeRuntimeAssociationProviderResourceId({
      runtimeRoleId: id('runtime-role'),
      instanceProfileId: id('runtime-identity'),
    });
  }
  if (resourceKey === 'substrate') {
    assertAwsEc2InstanceId(id(resourceKey));
    return id(resourceKey);
  }
  if (
    resourceKey === 'application-state-attachment' ||
    resourceKey === 'control-state-attachment'
  ) {
    const volumeKey =
      resourceKey === 'application-state-attachment'
        ? 'application-state'
        : 'control-state';
    return getAwsSingleNodeVolumeAttachmentProviderResourceId(
      authority.providerSpec,
      volumeKey,
      id('substrate'),
      id(volumeKey),
    );
  }
  throw new AwsSingleNodeDestroyedResourceLocatorAuthorityError();
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} operation @returns {Map<string, Readonly<Record<string, any>>>} */
function validateHistoricalStates(authority, plan, operation) {
  const applyOrder = getAwsSingleNodeResourceApplyOrder();
  const actionByKey = new Map(
    plan.actions.map((/** @type {Readonly<Record<string, any>>} */ action) => [
      action.resourceKey,
      action,
    ]),
  );
  if (
    actionByKey.size !== applyOrder.length ||
    applyOrder.some((resourceKey) => !actionByKey.has(resourceKey))
  ) {
    throw new AwsSingleNodeDestroyedResourceLocatorAuthorityError();
  }
  const intentByActionId = new Map(
    operation.intents.map(
      (/** @type {Readonly<Record<string, any>>} */ intent) => [
        intent.actionId,
        intent,
      ],
    ),
  );
  const stateByKey = new Map();
  for (const resourceKey of applyOrder) {
    const action = actionByKey.get(resourceKey);
    const definition = getAwsSingleNodeResourceDefinition(resourceKey);
    const intent = action && intentByActionId.get(action.actionId);
    if (
      action === undefined ||
      definition === null ||
      intent?.status !== 'settled' ||
      action.before === null ||
      action.before.providerType !== definition.providerType ||
      typeof action.before.providerResourceId !== 'string'
    ) {
      throw new AwsSingleNodeDestroyedResourceLocatorAuthorityError();
    }
    try {
      assertDeploymentActionId(action.actionId);
      if (action.management === 'managed') {
        validateOwnershipNonce(intent.ownershipNonce);
      } else if (intent.ownershipNonce !== null) {
        throw new Error();
      }
    } catch {
      throw new AwsSingleNodeDestroyedResourceLocatorAuthorityError();
    }
    stateByKey.set(resourceKey, action.before);
  }
  for (const resourceKey of applyOrder) {
    try {
      if (
        stateByKey.get(resourceKey)?.providerResourceId !==
        expectedProviderResourceId(resourceKey, stateByKey, authority)
      ) {
        throw new Error();
      }
    } catch {
      throw new AwsSingleNodeDestroyedResourceLocatorAuthorityError();
    }
  }
  return stateByKey;
}

/**
 * Recover a read-only historical provider locator only from one canonical,
 * fully settled destroy PlanV3 and its exact durable operation receipt.
 * The locator never authorizes ownership or absence by itself; conclusions
 * still require exact fresh reads or finite containing-resource evidence.
 * @param {unknown} value - Canonical resource observation authority.
 * @returns {Readonly<Record<string, any>>|null} - Purged-resource locator.
 */
export function createAwsSingleNodeDestroyedResourceLocator(value) {
  const authority = canonicalAuthority(value);
  const lineage = completedDestroyLineage(authority);
  if (lineage === null || authority.target.onDestroy !== 'purge') return null;
  const { plan, operation } = lineage;
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<Record<string, any>>} */ action) =>
      action.resourceKey === authority.target.resourceKey,
  );
  const action = plan.actions[actionIndex];
  const intent = operation.intents[actionIndex];
  if (
    action === undefined ||
    intent === undefined ||
    action.action !== 'delete' ||
    action.after !== null ||
    intent.actionId !== action.actionId ||
    intent.status !== 'settled'
  ) {
    return null;
  }
  const stateByKey = validateHistoricalStates(authority, plan, operation);
  const providerState = stateByKey.get(action.resourceKey);
  if (providerState === undefined) {
    throw new AwsSingleNodeDestroyedResourceLocatorAuthorityError();
  }
  const dependencies = action.dependsOn.map(
    (/** @type {string} */ resourceKey) => {
      const state = stateByKey.get(resourceKey);
      if (state === undefined) {
        throw new AwsSingleNodeDestroyedResourceLocatorAuthorityError();
      }
      return {
        resourceKey,
        providerIdentity: {
          providerType: state.providerType,
          providerResourceId: state.providerResourceId,
        },
      };
    },
  );
  return deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: 1,
      kind: 'awsSingleNodeDestroyedResourceLocator',
      planId: plan.planId,
      actionId: action.actionId,
      resourceKey: action.resourceKey,
      ownershipNonce: intent.ownershipNonce,
      providerState,
      dependencies,
    }),
  );
}

export default {
  AwsSingleNodeDestroyedResourceLocatorAuthorityError,
  createAwsSingleNodeDestroyedResourceLocator,
};
