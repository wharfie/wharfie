/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable catalog contracts are clearer than repeated parser-specific expansions. */

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import {
  getAwsSingleNodeDefaultIpv4RouteProviderResourceId,
  getAwsSingleNodeDefaultIpv4RouteStateDigest,
} from './deployment-aws-default-ipv4-route-resource.js';
import {
  getAwsSingleNodeInternetGatewayAttachmentProviderResourceId,
  getAwsSingleNodeInternetGatewayAttachmentStateDigest,
} from './deployment-aws-internet-gateway-attachment-resource.js';
import { getAwsSingleNodeInternetGatewayStateDigest } from './deployment-aws-internet-gateway-resource.js';
import { getAwsSingleNodeManagedArtifactStateDigest } from './deployment-aws-managed-artifact-resource.js';
import { getAwsSingleNodeNodeStateDigest } from './deployment-aws-node-resource.js';
import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import { getAwsSingleNodeRouteTableStateDigest } from './deployment-aws-route-table-resource.js';
import {
  assertAwsEc2InstanceId,
  assertAwsIamInstanceProfileId,
  assertAwsIamRoleId,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeAssociationStateDigest,
  getAwsSingleNodeRuntimeInstanceProfileStateDigest,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimePolicyStateDigest,
  getAwsSingleNodeRuntimeRoleStateDigest,
} from './deployment-aws-runtime-identity-contract.js';
import { getAwsSingleNodeSecurityGroupStateDigest } from './deployment-aws-security-group-resource.js';
import { getAwsSingleNodeSubnetStateDigest } from './deployment-aws-subnet-resource.js';
import {
  getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId,
  getAwsSingleNodeSubnetRouteTableAssociationStateDigest,
} from './deployment-aws-subnet-route-table-association-resource.js';
import {
  getAwsSingleNodeVolumeAttachmentProviderResourceId,
  getAwsSingleNodeVolumeAttachmentStateDigest,
} from './deployment-aws-volume-attachment-resource.js';
import { getAwsSingleNodeVolumeStateDigest } from './deployment-aws-volume-resource.js';
import { getAwsSingleNodeVpcStateDigest } from './deployment-aws-vpc-resource.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import {
  assertDeploymentInstanceId,
  getDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';
import {
  AWS_SINGLE_NODE_RESOURCE_GRAPH,
  getAwsSingleNodeResourceDefinition,
} from './deployment-resource-graph.js';
import { assertDeploymentIncarnationId } from './deployment-resource-binding.js';
import { validateDeploymentRevision } from './deployment-revision.js';
import { cloneJsonObject } from './json-value.js';

const INPUT_KEYS = new Set([
  'deploymentRevision',
  'profile',
  'providerScope',
  'providerSpec',
  'deploymentInstanceId',
  'incarnationId',
  'head',
]);

const VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/;
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const INTERNET_GATEWAY_ID_PATTERN = /^igw-[0-9a-f]{8,32}$/;
const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,32}$/;
const ROUTE_TABLE_ID_PATTERN = /^rtb-[0-9a-f]{8,32}$/;
const SECURITY_GROUP_ID_PATTERN = /^sg-[0-9a-f]{8,32}$/;

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertAllKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {Readonly<Record<string, any>>} profile @param {string} capabilityKind @returns {'managed'|'external'} */
function capabilityManagement(profile, capabilityKind) {
  const configuration = profile.provider.configuration;
  const management =
    capabilityKind === 'resident-node'
      ? configuration.node.management
      : capabilityKind === 'application-state'
        ? configuration.applicationState.management
        : capabilityKind === 'control-state'
          ? configuration.controlState.management
          : capabilityKind === 'artifact-storage'
            ? configuration.artifactStorage.management
            : capabilityKind === 'runtime-identity'
              ? configuration.runtimeIdentity.management
              : capabilityKind === 'networking'
                ? configuration.networking.management
                : capabilityKind === 'ingress'
                  ? configuration.ingress.management
                  : null;
  if (management !== 'managed' && management !== 'external') {
    throw new Error(
      `AWS single-node capability '${capabilityKind}' does not have a supported resource-management mode.`,
    );
  }
  return management;
}

/** @param {string} resourceKey @param {Readonly<Record<string, any>>} authority @returns {Readonly<{algorithm: 'sha256', value: string}>} */
function desiredStateDigest(resourceKey, authority) {
  const nameAuthority = {
    providerScopeId: authority.providerScope.providerScopeId,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
  };
  const policyAuthority = {
    providerScope: authority.providerScope,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
  };
  if (resourceKey === 'artifact') {
    return getAwsSingleNodeManagedArtifactStateDigest(authority);
  }
  if (resourceKey === 'application-state' || resourceKey === 'control-state') {
    return getAwsSingleNodeVolumeStateDigest(
      authority.providerSpec,
      resourceKey,
    );
  }
  if (resourceKey === 'network-vpc') {
    return getAwsSingleNodeVpcStateDigest(authority.providerSpec);
  }
  if (resourceKey === 'network-internet-gateway') {
    return getAwsSingleNodeInternetGatewayStateDigest(authority.providerSpec);
  }
  if (resourceKey === 'network-internet-gateway-attachment') {
    return getAwsSingleNodeInternetGatewayAttachmentStateDigest(
      authority.providerSpec,
    );
  }
  if (resourceKey === 'network-subnet') {
    return getAwsSingleNodeSubnetStateDigest(authority.providerSpec);
  }
  if (resourceKey === 'network-route-table') {
    return getAwsSingleNodeRouteTableStateDigest(authority.providerSpec);
  }
  if (resourceKey === 'network-default-ipv4-route') {
    return getAwsSingleNodeDefaultIpv4RouteStateDigest(authority.providerSpec);
  }
  if (resourceKey === 'network-subnet-route-table-association') {
    return getAwsSingleNodeSubnetRouteTableAssociationStateDigest(
      authority.providerSpec,
    );
  }
  if (resourceKey === 'network-security-group') {
    return getAwsSingleNodeSecurityGroupStateDigest(authority.providerSpec);
  }
  if (resourceKey === 'runtime-role') {
    return getAwsSingleNodeRuntimeRoleStateDigest(nameAuthority);
  }
  if (resourceKey === 'runtime-role-policy') {
    return getAwsSingleNodeRuntimePolicyStateDigest(policyAuthority);
  }
  if (resourceKey === 'runtime-identity') {
    return getAwsSingleNodeRuntimeInstanceProfileStateDigest(nameAuthority);
  }
  if (resourceKey === 'runtime-identity-role-association') {
    return getAwsSingleNodeRuntimeAssociationStateDigest(nameAuthority);
  }
  if (resourceKey === 'substrate') {
    return getAwsSingleNodeNodeStateDigest(
      authority.providerSpec,
      nameAuthority,
    );
  }
  if (
    resourceKey === 'application-state-attachment' ||
    resourceKey === 'control-state-attachment'
  ) {
    return getAwsSingleNodeVolumeAttachmentStateDigest(
      authority.providerSpec,
      resourceKey === 'application-state-attachment'
        ? 'application-state'
        : 'control-state',
    );
  }
  throw new Error(
    `AWS single-node resource '${resourceKey}' is not supported.`,
  );
}

/** @param {string} resourceKey @param {Map<string, Readonly<Record<string, any>>>} bindingByKey @param {Readonly<Record<string, any>>} authority @returns {string} */
function expectedProviderResourceId(resourceKey, bindingByKey, authority) {
  /** @param {string} dependencyKey @returns {string} */
  function id(dependencyKey) {
    const binding = bindingByKey.get(dependencyKey);
    if (binding === undefined) {
      throw new Error(
        `AWS single-node binding '${resourceKey}' is missing dependency binding '${dependencyKey}'.`,
      );
    }
    return binding.providerResourceId;
  }

  if (resourceKey === 'artifact') {
    return getAwsSingleNodeManagedArtifactObjectLocation({
      providerScope: authority.providerScope,
      deploymentInstanceId: authority.deploymentInstanceId,
      incarnationId: authority.incarnationId,
    }).arn;
  }
  if (resourceKey === 'application-state' || resourceKey === 'control-state') {
    const resourceId = id(resourceKey);
    if (!VOLUME_ID_PATTERN.test(resourceId)) {
      throw new Error(
        `AWS single-node binding '${resourceKey}' has an invalid EBS volume ID.`,
      );
    }
    return resourceId;
  }
  if (resourceKey === 'network-vpc') {
    const resourceId = id(resourceKey);
    if (!VPC_ID_PATTERN.test(resourceId)) {
      throw new Error(
        `AWS single-node binding '${resourceKey}' has an invalid VPC ID.`,
      );
    }
    return resourceId;
  }
  if (resourceKey === 'network-internet-gateway') {
    const resourceId = id(resourceKey);
    if (!INTERNET_GATEWAY_ID_PATTERN.test(resourceId)) {
      throw new Error(
        `AWS single-node binding '${resourceKey}' has an invalid internet gateway ID.`,
      );
    }
    return resourceId;
  }
  if (resourceKey === 'network-internet-gateway-attachment') {
    return getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
      id('network-internet-gateway'),
      id('network-vpc'),
    );
  }
  if (resourceKey === 'network-subnet') {
    const resourceId = id(resourceKey);
    if (!SUBNET_ID_PATTERN.test(resourceId)) {
      throw new Error(
        `AWS single-node binding '${resourceKey}' has an invalid subnet ID.`,
      );
    }
    return resourceId;
  }
  if (resourceKey === 'network-route-table') {
    const resourceId = id(resourceKey);
    if (!ROUTE_TABLE_ID_PATTERN.test(resourceId)) {
      throw new Error(
        `AWS single-node binding '${resourceKey}' has an invalid route-table ID.`,
      );
    }
    return resourceId;
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
    const resourceId = id(resourceKey);
    if (!SECURITY_GROUP_ID_PATTERN.test(resourceId)) {
      throw new Error(
        `AWS single-node binding '${resourceKey}' has an invalid security-group ID.`,
      );
    }
    return resourceId;
  }
  if (resourceKey === 'runtime-role') {
    const resourceId = id(resourceKey);
    assertAwsIamRoleId(
      resourceId,
      `binding '${resourceKey}' providerResourceId`,
    );
    return resourceId;
  }
  if (resourceKey === 'runtime-role-policy') {
    return getAwsSingleNodeRuntimePolicyProviderResourceId({
      runtimeRoleId: id('runtime-role'),
    });
  }
  if (resourceKey === 'runtime-identity') {
    const resourceId = id(resourceKey);
    assertAwsIamInstanceProfileId(
      resourceId,
      `binding '${resourceKey}' providerResourceId`,
    );
    return resourceId;
  }
  if (resourceKey === 'runtime-identity-role-association') {
    return getAwsSingleNodeRuntimeAssociationProviderResourceId({
      runtimeRoleId: id('runtime-role'),
      instanceProfileId: id('runtime-identity'),
    });
  }
  if (resourceKey === 'substrate') {
    const resourceId = id(resourceKey);
    assertAwsEc2InstanceId(
      resourceId,
      `binding '${resourceKey}' providerResourceId`,
    );
    return resourceId;
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
  throw new Error(
    `AWS single-node resource '${resourceKey}' is not supported.`,
  );
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} definition @param {'managed'|'external'} management @param {Map<string, Readonly<Record<string, any>>>} bindingByKey @param {Readonly<Record<string, any>>} authority @returns {void} */
function validateBinding(
  binding,
  definition,
  management,
  bindingByKey,
  authority,
) {
  const expectedDependencies = definition.dependsOn
    .map((/** @type {string} */ dependencyKey) => {
      const dependency = bindingByKey.get(dependencyKey);
      if (dependency === undefined) {
        throw new Error(
          `AWS single-node binding '${binding.resourceKey}' is missing dependency binding '${dependencyKey}'.`,
        );
      }
      return { resourceKey: dependencyKey, bindingId: dependency.bindingId };
    })
    .sort(
      (
        /** @type {{resourceKey: string}} */ left,
        /** @type {{resourceKey: string}} */ right,
      ) => compareCanonicalStrings(left.resourceKey, right.resourceKey),
    );
  if (
    binding.resourceKey !== definition.resourceKey ||
    !sameJson(binding.capability, definition.capability) ||
    !sameJson(binding.role, definition.role) ||
    binding.management !== management ||
    binding.ownershipMode !== definition.ownershipMode ||
    binding.onDestroy !== definition.onDestroy ||
    binding.providerType !== definition.providerType ||
    binding.deploymentInstanceId !== authority.deploymentInstanceId ||
    binding.incarnationId !== authority.incarnationId ||
    binding.providerScopeId !== authority.providerScope.providerScopeId ||
    !sameJson(binding.dependencyBindings, expectedDependencies)
  ) {
    throw new Error(
      `AWS single-node binding '${binding.resourceKey}' does not match its exact resource graph and deployment context.`,
    );
  }
  const expectedId = expectedProviderResourceId(
    binding.resourceKey,
    bindingByKey,
    authority,
  );
  if (binding.providerResourceId !== expectedId) {
    throw new Error(
      `AWS single-node binding '${binding.resourceKey}' does not match its exact provider identity.`,
    );
  }
}

/**
 * Build the deterministic desired target for every resource in the fixed AWS
 * single-node graph. Durable provider IDs are reused only after complete
 * binding revalidation; absent IDs are never guessed from partial lineage.
 * @param {unknown} value - Exact deployment and optional durable-head context.
 * @returns {Readonly<Array<Readonly<Record<string, any>>>>} - Apply-ordered target catalog.
 */
export function createAwsSingleNodeDesiredResourceTargetCatalog(value) {
  const input = cloneJsonObject(value, 'awsSingleNodeDesiredResourceTargets');
  assertAllKeys(input, INPUT_KEYS, 'awsSingleNodeDesiredResourceTargets');
  const deploymentRevision = validateDeploymentRevision(
    input.deploymentRevision,
    'awsSingleNodeDesiredResourceTargets.deploymentRevision',
  );
  const profile = validateDeploymentProfile(
    input.profile,
    'awsSingleNodeDesiredResourceTargets.profile',
  );
  const providerScope = validateProviderScope(
    input.providerScope,
    'awsSingleNodeDesiredResourceTargets.providerScope',
  );
  const providerSpec = validateAwsSingleNodeProviderSpecContext(
    input.providerSpec,
    { profile, providerScope },
  );
  assertDeploymentInstanceId(
    input.deploymentInstanceId,
    'awsSingleNodeDesiredResourceTargets.deploymentInstanceId',
  );
  assertDeploymentIncarnationId(
    input.incarnationId,
    'awsSingleNodeDesiredResourceTargets.incarnationId',
  );
  if (
    deploymentRevision.profileRevisionId !== profile.profileRevisionId ||
    deploymentRevision.appId !== profile.appId ||
    input.deploymentInstanceId !==
      getDeploymentInstanceId({ deploymentRevision, providerScope })
  ) {
    throw new Error(
      'AWS single-node desired-resource target deployment revision, profile, provider scope, and instance identity do not match.',
    );
  }

  const head =
    input.head === null
      ? null
      : validateDeploymentHead(
          input.head,
          'awsSingleNodeDesiredResourceTargets.head',
        );
  if (
    head !== null &&
    (head.deploymentInstanceId !== input.deploymentInstanceId ||
      head.providerScope.providerScopeId !== providerScope.providerScopeId)
  ) {
    throw new Error(
      'AWS single-node desired-resource target head does not match the exact deployment instance and provider scope.',
    );
  }
  if (
    head !== null &&
    head.incarnationId !== input.incarnationId &&
    !(head.phase === 'DESTROYED' && head.resourceBindings.length === 0)
  ) {
    throw new Error(
      'AWS single-node desired-resource target head does not authorize the requested incarnation.',
    );
  }
  if (
    head !== null &&
    (head.phase === 'CONVERGING' || head.phase === 'READY'
      ? head.targetDeploymentRevisionId !==
        deploymentRevision.deploymentRevisionId
      : head.phase === 'DESTROYING'
        ? head.settledDeploymentRevisionId !==
          deploymentRevision.deploymentRevisionId
        : false)
  ) {
    throw new Error(
      'AWS single-node desired-resource target head does not match the exact deployment revision.',
    );
  }

  const authority = deepFreeze({
    deploymentRevision,
    profile,
    providerScope,
    providerSpec,
    deploymentInstanceId: input.deploymentInstanceId,
    incarnationId: input.incarnationId,
  });
  /** @type {Readonly<Record<string, any>>[]} */
  const bindings = head?.resourceBindings ?? [];
  const bindingByKey = new Map(
    bindings.map((/** @type {Readonly<Record<string, any>>} */ binding) => [
      binding.resourceKey,
      binding,
    ]),
  );
  if (bindingByKey.size !== bindings.length) {
    throw new Error(
      'AWS single-node desired-resource target head contains duplicate resource bindings.',
    );
  }
  const seenRoles = new Set();
  for (const binding of bindings) {
    const definition = getAwsSingleNodeResourceDefinition(binding.resourceKey);
    if (definition === null) {
      throw new Error(
        `AWS single-node desired-resource target head contains unknown binding '${binding.resourceKey}'.`,
      );
    }
    const roleKey = `${binding.capability.kind}\0${binding.role.kind}`;
    if (seenRoles.has(roleKey)) {
      throw new Error(
        'AWS single-node desired-resource target head contains duplicate capability roles.',
      );
    }
    seenRoles.add(roleKey);
    validateBinding(
      binding,
      definition,
      capabilityManagement(profile, definition.capability.kind),
      bindingByKey,
      authority,
    );
  }

  const artifactProviderResourceId =
    getAwsSingleNodeManagedArtifactObjectLocation({
      providerScope,
      deploymentInstanceId: input.deploymentInstanceId,
      incarnationId: input.incarnationId,
    }).arn;
  return deepFreeze(
    AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
      (/** @type {Readonly<Record<string, any>>} */ definition) => {
        const binding = bindingByKey.get(definition.resourceKey);
        return {
          resourceKey: definition.resourceKey,
          capability: definition.capability,
          role: definition.role,
          management: capabilityManagement(profile, definition.capability.kind),
          ownershipMode: definition.ownershipMode,
          dependsOn: definition.dependsOn,
          onDestroy: definition.onDestroy,
          target: {
            providerType: definition.providerType,
            providerResourceId:
              definition.resourceKey === 'artifact'
                ? artifactProviderResourceId
                : (binding?.providerResourceId ?? null),
            stateDigest: desiredStateDigest(definition.resourceKey, authority),
          },
        };
      },
    ),
  );
}

export default {
  createAwsSingleNodeDesiredResourceTargetCatalog,
};
