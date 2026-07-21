/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable graph contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { DEPLOYMENT_CAPABILITY_KINDS } from './deployment-profile.js';
import { cloneJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';

export const AWS_SINGLE_NODE_RESOURCE_GRAPH_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_RESOURCE_GRAPH_KIND = 'awsSingleNodeResourceGraph';
export const AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_DOMAIN =
  'wharfie:aws-single-node-resource-graph:v1';
export const AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_PREFIX = 'wrg1';
export const AWS_SINGLE_NODE_RESOURCE_GRAPH_MAX_RESOURCES = 32;

const PAYLOAD_KEYS = new Set(['schemaVersion', 'kind', 'resources']);
const DOCUMENT_KEYS = new Set(['resourceGraphId', ...PAYLOAD_KEYS]);
const RESOURCE_KEYS = new Set([
  'resourceKey',
  'role',
  'capability',
  'providerType',
  'ownershipMode',
  'dependsOn',
  'onDestroy',
]);
const MARKER_KEYS = new Set(['kind', 'version']);
/** @type {Set<string>} */
const KNOWN_CAPABILITIES = new Set(DEPLOYMENT_CAPABILITY_KINDS);
/** @type {Set<string>} */
const DERIVED_ROLE_KINDS = new Set([
  'internet-gateway-attachment',
  'default-ipv4-route',
  'subnet-route-table-association',
  'attachment',
]);

/**
 * The fixed resource contract is deliberately data. Provider drivers may
 * implement only these finite roles and cannot smuggle generic IaC through a
 * plan. `dependencies` are sets here; their serialized order is instead
 * required to follow the graph's topological apply order.
 */
/** @type {Readonly<Array<Readonly<{resourceKey: string, roleKind: string, capabilityKind: string, providerType: string, ownershipMode: 'direct'|'derived', dependencies: Readonly<Array<string>>, onDestroy: 'retain'|'purge'}>>>} */
const RESOURCE_CONTRACTS = Object.freeze([
  Object.freeze({
    resourceKey: 'artifact',
    roleKind: 'object',
    capabilityKind: 'artifact-storage',
    providerType: 's3-object',
    ownershipMode: 'direct',
    dependencies: Object.freeze([]),
    onDestroy: 'purge',
  }),
  Object.freeze({
    resourceKey: 'application-state',
    roleKind: 'volume',
    capabilityKind: 'application-state',
    providerType: 'ebs-volume',
    ownershipMode: 'direct',
    dependencies: Object.freeze([]),
    onDestroy: 'retain',
  }),
  Object.freeze({
    resourceKey: 'control-state',
    roleKind: 'volume',
    capabilityKind: 'control-state',
    providerType: 'ebs-volume',
    ownershipMode: 'direct',
    dependencies: Object.freeze([]),
    onDestroy: 'retain',
  }),
  Object.freeze({
    resourceKey: 'network-vpc',
    roleKind: 'vpc',
    capabilityKind: 'networking',
    providerType: 'ec2-vpc',
    ownershipMode: 'direct',
    dependencies: Object.freeze([]),
    onDestroy: 'purge',
  }),
  Object.freeze({
    resourceKey: 'network-internet-gateway',
    roleKind: 'internet-gateway',
    capabilityKind: 'networking',
    providerType: 'ec2-internet-gateway',
    ownershipMode: 'direct',
    dependencies: Object.freeze([]),
    onDestroy: 'purge',
  }),
  Object.freeze({
    resourceKey: 'network-internet-gateway-attachment',
    roleKind: 'internet-gateway-attachment',
    capabilityKind: 'networking',
    providerType: 'ec2-internet-gateway-attachment',
    ownershipMode: 'derived',
    dependencies: Object.freeze(['network-vpc', 'network-internet-gateway']),
    onDestroy: 'purge',
  }),
  Object.freeze({
    resourceKey: 'network-subnet',
    roleKind: 'subnet',
    capabilityKind: 'networking',
    providerType: 'ec2-subnet',
    ownershipMode: 'direct',
    dependencies: Object.freeze(['network-vpc']),
    onDestroy: 'purge',
  }),
  Object.freeze({
    resourceKey: 'network-route-table',
    roleKind: 'route-table',
    capabilityKind: 'networking',
    providerType: 'ec2-route-table',
    ownershipMode: 'direct',
    dependencies: Object.freeze(['network-vpc']),
    onDestroy: 'purge',
  }),
  Object.freeze({
    resourceKey: 'network-default-ipv4-route',
    roleKind: 'default-ipv4-route',
    capabilityKind: 'networking',
    providerType: 'ec2-ipv4-route',
    ownershipMode: 'derived',
    dependencies: Object.freeze([
      'network-internet-gateway-attachment',
      'network-route-table',
    ]),
    onDestroy: 'purge',
  }),
  Object.freeze({
    resourceKey: 'network-subnet-route-table-association',
    roleKind: 'subnet-route-table-association',
    capabilityKind: 'networking',
    providerType: 'ec2-subnet-route-table-association',
    ownershipMode: 'derived',
    dependencies: Object.freeze([
      'network-subnet',
      'network-route-table',
      'network-default-ipv4-route',
    ]),
    onDestroy: 'purge',
  }),
  Object.freeze({
    resourceKey: 'network-security-group',
    roleKind: 'security-group',
    capabilityKind: 'networking',
    providerType: 'ec2-security-group',
    ownershipMode: 'direct',
    dependencies: Object.freeze(['network-vpc']),
    onDestroy: 'purge',
  }),
  Object.freeze({
    resourceKey: 'runtime-identity',
    roleKind: 'instance-profile',
    capabilityKind: 'runtime-identity',
    providerType: 'instance-profile',
    ownershipMode: 'direct',
    dependencies: Object.freeze([]),
    onDestroy: 'purge',
  }),
  Object.freeze({
    resourceKey: 'substrate',
    roleKind: 'node',
    capabilityKind: 'resident-node',
    providerType: 'ec2-instance',
    ownershipMode: 'direct',
    dependencies: Object.freeze([
      'artifact',
      'network-subnet',
      'network-default-ipv4-route',
      'network-subnet-route-table-association',
      'network-security-group',
      'runtime-identity',
    ]),
    onDestroy: 'purge',
  }),
  Object.freeze({
    resourceKey: 'application-state-attachment',
    roleKind: 'attachment',
    capabilityKind: 'application-state',
    providerType: 'ebs-volume-attachment',
    ownershipMode: 'derived',
    dependencies: Object.freeze(['application-state', 'substrate']),
    onDestroy: 'purge',
  }),
  Object.freeze({
    resourceKey: 'control-state-attachment',
    roleKind: 'attachment',
    capabilityKind: 'control-state',
    providerType: 'ebs-volume-attachment',
    ownershipMode: 'derived',
    dependencies: Object.freeze(['control-state', 'substrate']),
    onDestroy: 'purge',
  }),
]);

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
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {unknown} value @param {string} path @returns {{kind: string, version: 1}} */
function validateMarker(value, path) {
  const marker = cloneJsonObject(value, path);
  assertAllKeys(marker, MARKER_KEYS, path);
  assertLogicalId(marker.kind, `${path}.kind`);
  if (marker.version !== 1) {
    throw new TypeError(`${path}.version must be the integer 1.`);
  }
  return { kind: marker.kind, version: 1 };
}

/** @param {unknown} value @param {string} path @returns {Record<string, any>} */
function validateResource(value, path) {
  const resource = cloneJsonObject(value, path);
  assertAllKeys(resource, RESOURCE_KEYS, path);
  assertLogicalId(resource.resourceKey, `${path}.resourceKey`);
  const role = validateMarker(resource.role, `${path}.role`);
  const capability = validateMarker(resource.capability, `${path}.capability`);
  if (!KNOWN_CAPABILITIES.has(capability.kind)) {
    throw new TypeError(`${path}.capability.kind is not supported.`);
  }
  assertLogicalId(resource.providerType, `${path}.providerType`);
  if (
    resource.ownershipMode !== 'direct' &&
    resource.ownershipMode !== 'derived'
  ) {
    throw new TypeError(`${path}.ownershipMode must be 'direct' or 'derived'.`);
  }
  const expectedOwnershipMode = DERIVED_ROLE_KINDS.has(role.kind)
    ? 'derived'
    : 'direct';
  if (resource.ownershipMode !== expectedOwnershipMode) {
    throw new Error(
      `${path}.ownershipMode must be '${expectedOwnershipMode}' for role '${role.kind}'.`,
    );
  }
  if (!Array.isArray(resource.dependsOn)) {
    throw new TypeError(`${path}.dependsOn must be an array.`);
  }
  const dependencyKeys = new Set();
  const dependsOn = resource.dependsOn.map((dependency, index) => {
    assertLogicalId(dependency, `${path}.dependsOn[${index}]`);
    if (dependencyKeys.has(dependency)) {
      throw new Error(`${path}.dependsOn must contain unique resource keys.`);
    }
    dependencyKeys.add(dependency);
    return dependency;
  });
  if (resource.onDestroy !== 'retain' && resource.onDestroy !== 'purge') {
    throw new TypeError(`${path}.onDestroy must be 'retain' or 'purge'.`);
  }
  const expectedOnDestroy = role.kind === 'volume' ? 'retain' : 'purge';
  if (resource.onDestroy !== expectedOnDestroy) {
    throw new Error(
      `${path}.onDestroy must be '${expectedOnDestroy}' for role '${role.kind}'.`,
    );
  }
  return {
    resourceKey: resource.resourceKey,
    role,
    capability,
    providerType: resource.providerType,
    ownershipMode: resource.ownershipMode,
    dependsOn,
    onDestroy: resource.onDestroy,
  };
}

/** @param {Readonly<Record<string, any>>[]} resources @param {Map<string, number>} indexByKey @param {string} path @returns {void} */
function assertAcyclic(resources, indexByKey, path) {
  const visiting = new Set();
  const visited = new Set();

  /** @param {string} resourceKey @returns {void} */
  function visit(resourceKey) {
    if (visited.has(resourceKey)) return;
    if (visiting.has(resourceKey)) {
      throw new Error(`${path}.resources dependency graph must be acyclic.`);
    }
    visiting.add(resourceKey);
    const resourceIndex = indexByKey.get(resourceKey);
    if (resourceIndex === undefined || resources[resourceIndex] === undefined) {
      throw new Error(
        `${path}.resources dependency graph references an unknown resource.`,
      );
    }
    const resource = resources[resourceIndex];
    for (const dependency of resource.dependsOn) visit(dependency);
    visiting.delete(resourceKey);
    visited.add(resourceKey);
  }

  for (const resource of resources) visit(resource.resourceKey);
}

/** @param {Readonly<Record<string, any>>[]} resources @param {Map<string, number>} indexByKey @param {string} path @returns {void} */
function assertTopologicalApplyOrder(resources, indexByKey, path) {
  for (
    let resourceIndex = 0;
    resourceIndex < resources.length;
    resourceIndex += 1
  ) {
    let previousDependencyIndex = -1;
    const resource = resources[resourceIndex];
    for (
      let dependencyIndex = 0;
      dependencyIndex < resource.dependsOn.length;
      dependencyIndex += 1
    ) {
      const dependencyKey = resource.dependsOn[dependencyIndex];
      const resolvedIndex = /** @type {number} */ (
        indexByKey.get(dependencyKey)
      );
      if (resolvedIndex >= resourceIndex) {
        throw new Error(
          `${path}.resources[${resourceIndex}].dependsOn[${dependencyIndex}] must reference an earlier resource in topological apply order.`,
        );
      }
      if (resolvedIndex <= previousDependencyIndex) {
        throw new Error(
          `${path}.resources[${resourceIndex}].dependsOn must follow topological apply order.`,
        );
      }
      previousDependencyIndex = resolvedIndex;
    }
  }
}

/** @param {Readonly<Record<string, any>>[]} resources @param {string} path @returns {void} */
function assertFiniteResourceContract(resources, path) {
  if (resources.length !== RESOURCE_CONTRACTS.length) {
    throw new Error(
      `${path}.resources must contain the complete ${RESOURCE_CONTRACTS.length}-resource AWS single-node contract.`,
    );
  }

  for (let index = 0; index < resources.length; index += 1) {
    const resource = resources[index];
    const contract = RESOURCE_CONTRACTS[index];
    if (resource.resourceKey !== contract.resourceKey) {
      throw new Error(
        `${path}.resources[${index}].resourceKey must be '${contract.resourceKey}' in canonical apply order.`,
      );
    }
    if (
      resource.role.kind !== contract.roleKind ||
      resource.capability.kind !== contract.capabilityKind ||
      resource.providerType !== contract.providerType ||
      resource.ownershipMode !== contract.ownershipMode ||
      resource.onDestroy !== contract.onDestroy
    ) {
      throw new Error(
        `${path}.resources[${index}] does not match the finite contract for '${resource.resourceKey}'.`,
      );
    }
    if (
      resource.dependsOn.length !== contract.dependencies.length ||
      resource.dependsOn.some(
        (/** @type {string} */ dependency) =>
          !contract.dependencies.includes(dependency),
      )
    ) {
      throw new Error(
        `${path}.resources[${index}].dependsOn does not match the finite contract for '${resource.resourceKey}'.`,
      );
    }
  }
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validatePayload(value, path) {
  const graph = cloneJsonObject(value, path);
  assertAllKeys(graph, PAYLOAD_KEYS, path);
  if (graph.schemaVersion !== AWS_SINGLE_NODE_RESOURCE_GRAPH_SCHEMA_VERSION) {
    throw new TypeError(`${path}.schemaVersion must be the integer 1.`);
  }
  if (graph.kind !== AWS_SINGLE_NODE_RESOURCE_GRAPH_KIND) {
    throw new TypeError(
      `${path}.kind must be '${AWS_SINGLE_NODE_RESOURCE_GRAPH_KIND}'.`,
    );
  }
  if (!Array.isArray(graph.resources)) {
    throw new TypeError(`${path}.resources must be an array.`);
  }
  if (graph.resources.length > AWS_SINGLE_NODE_RESOURCE_GRAPH_MAX_RESOURCES) {
    throw new RangeError(
      `${path}.resources must contain at most ${AWS_SINGLE_NODE_RESOURCE_GRAPH_MAX_RESOURCES} resources.`,
    );
  }
  const resources = graph.resources.map((resource, index) =>
    validateResource(resource, `${path}.resources[${index}]`),
  );

  const indexByKey = new Map();
  const roleKeys = new Set();
  for (let index = 0; index < resources.length; index += 1) {
    const resource = resources[index];
    if (indexByKey.has(resource.resourceKey)) {
      throw new Error(`${path}.resources must have unique resource keys.`);
    }
    indexByKey.set(resource.resourceKey, index);
    const roleKey = `${resource.capability.kind}\0${resource.role.kind}`;
    if (roleKeys.has(roleKey)) {
      throw new Error(
        `${path}.resources must have unique roles within each capability.`,
      );
    }
    roleKeys.add(roleKey);
  }

  for (let index = 0; index < resources.length; index += 1) {
    for (
      let dependencyIndex = 0;
      dependencyIndex < resources[index].dependsOn.length;
      dependencyIndex += 1
    ) {
      const dependency = resources[index].dependsOn[dependencyIndex];
      if (!indexByKey.has(dependency)) {
        throw new Error(
          `${path}.resources[${index}].dependsOn[${dependencyIndex}] does not identify a graph resource.`,
        );
      }
    }
  }

  assertAcyclic(resources, indexByKey, path);
  assertTopologicalApplyOrder(resources, indexByKey, path);
  assertFiniteResourceContract(resources, path);

  return deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: AWS_SINGLE_NODE_RESOURCE_GRAPH_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_RESOURCE_GRAPH_KIND,
      resources,
    }),
  );
}

/**
 * Canonicalize one resource graph payload before content addressing it.
 * @param {unknown} value - Candidate schema, kind, and resources.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Canonical frozen payload.
 */
export function canonicalizeAwsSingleNodeResourceGraphPayload(
  value,
  valuePath = 'awsSingleNodeResourceGraph',
) {
  return validatePayload(value, valuePath);
}

/**
 * Compute the identity of one valid resource graph payload.
 * @param {unknown} value - Candidate payload or serialized graph document.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {string} - `wrg1_<base64url SHA-256>` identity.
 */
export function getAwsSingleNodeResourceGraphId(
  value,
  valuePath = 'awsSingleNodeResourceGraph',
) {
  const candidate = cloneJsonObject(value, valuePath);
  const payload = Object.hasOwn(candidate, 'resourceGraphId')
    ? {
        schemaVersion: candidate.schemaVersion,
        kind: candidate.kind,
        resources: candidate.resources,
      }
    : candidate;
  const canonicalPayload = validatePayload(payload, valuePath);
  return createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_PREFIX,
    value: canonicalPayload,
    valuePath,
  });
}

/**
 * Validate a serialized graph and recompute its complete content identity.
 * @param {unknown} value - Candidate graph document.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Canonical frozen graph.
 */
export function validateAwsSingleNodeResourceGraph(
  value,
  valuePath = 'awsSingleNodeResourceGraph',
) {
  const graph = cloneJsonObject(value, valuePath);
  assertAllKeys(graph, DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    graph.resourceGraphId,
    AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_PREFIX,
    `${valuePath}.resourceGraphId`,
  );
  const payload = validatePayload(
    {
      schemaVersion: graph.schemaVersion,
      kind: graph.kind,
      resources: graph.resources,
    },
    valuePath,
  );
  const expectedId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (graph.resourceGraphId !== expectedId) {
    throw new Error(
      `${valuePath}.resourceGraphId does not match the canonical resource graph payload.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, resourceGraphId: expectedId }),
  );
}

const CURRENT_PAYLOAD = validatePayload(
  {
    schemaVersion: AWS_SINGLE_NODE_RESOURCE_GRAPH_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_RESOURCE_GRAPH_KIND,
    resources: RESOURCE_CONTRACTS.map((contract) => ({
      resourceKey: contract.resourceKey,
      role: { kind: contract.roleKind, version: 1 },
      capability: { kind: contract.capabilityKind, version: 1 },
      providerType: contract.providerType,
      ownershipMode: contract.ownershipMode,
      dependsOn: [...contract.dependencies],
      onDestroy: contract.onDestroy,
    })),
  },
  'AWS_SINGLE_NODE_RESOURCE_GRAPH',
);

/** The exact current AWS single-node physical-resource graph. */
export const AWS_SINGLE_NODE_RESOURCE_GRAPH = deepFreeze(
  sortCanonicalJsonValue({
    ...CURRENT_PAYLOAD,
    resourceGraphId: createCanonicalJsonSha256Id({
      domain: AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_DOMAIN,
      prefix: AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_PREFIX,
      value: CURRENT_PAYLOAD,
      valuePath: 'AWS_SINGLE_NODE_RESOURCE_GRAPH',
    }),
  }),
);

const CURRENT_RESOURCE_BY_KEY = new Map(
  AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
    (/** @type {Readonly<Record<string, any>>} */ resource) => [
      resource.resourceKey,
      resource,
    ],
  ),
);
const CURRENT_APPLY_ORDER = Object.freeze(
  AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
    (/** @type {Readonly<Record<string, any>>} */ resource) =>
      resource.resourceKey,
  ),
);
const CURRENT_DESTROY_ORDER = Object.freeze([...CURRENT_APPLY_ORDER].reverse());

/**
 * Look up one immutable current resource definition.
 * @param {unknown} resourceKey - Canonical resource key.
 * @returns {Readonly<Record<string, any>>|null} - Definition or null when unknown.
 */
export function getAwsSingleNodeResourceDefinition(resourceKey) {
  assertLogicalId(resourceKey, 'resourceKey');
  return CURRENT_RESOURCE_BY_KEY.get(resourceKey) ?? null;
}

/** @returns {Readonly<string[]>} - Current topological apply order. */
export function getAwsSingleNodeResourceApplyOrder() {
  return CURRENT_APPLY_ORDER;
}

/** @returns {Readonly<string[]>} - Current safe reverse-topological destroy order. */
export function getAwsSingleNodeResourceDestroyOrder() {
  return CURRENT_DESTROY_ORDER;
}

export default {
  AWS_SINGLE_NODE_RESOURCE_GRAPH,
  AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_DOMAIN,
  AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_PREFIX,
  AWS_SINGLE_NODE_RESOURCE_GRAPH_KIND,
  AWS_SINGLE_NODE_RESOURCE_GRAPH_MAX_RESOURCES,
  AWS_SINGLE_NODE_RESOURCE_GRAPH_SCHEMA_VERSION,
  canonicalizeAwsSingleNodeResourceGraphPayload,
  getAwsSingleNodeResourceApplyOrder,
  getAwsSingleNodeResourceDefinition,
  getAwsSingleNodeResourceDestroyOrder,
  getAwsSingleNodeResourceGraphId,
  validateAwsSingleNodeResourceGraph,
};
