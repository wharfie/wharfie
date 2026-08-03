import { describe, expect, it } from '@jest/globals';

import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
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
} from '../../src/core/runtime/deployment-resource-graph.js';

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {Record<string, any>} graph @returns {Record<string, any>} */
function withRecomputedIdentity(graph) {
  const copy = clone(graph);
  const payload = {
    schemaVersion: copy.schemaVersion,
    kind: copy.kind,
    resources: copy.resources,
  };
  copy.resourceGraphId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_PREFIX,
    value: payload,
  });
  return copy;
}

/**
 * @param {string} resourceKey
 * @param {string} capability
 * @param {string} role
 * @param {string} providerType
 * @param {'direct'|'derived'} ownershipMode
 * @param {string[]} dependsOn
 * @param {'retain'|'purge'} onDestroy
 */
function resource(
  resourceKey,
  capability,
  role,
  providerType,
  ownershipMode,
  dependsOn,
  onDestroy,
) {
  return {
    resourceKey,
    role: { kind: role, version: 1 },
    capability: { kind: capability, version: 1 },
    providerType,
    ownershipMode,
    dependsOn,
    onDestroy,
  };
}

const EXPECTED_RESOURCES = [
  resource(
    'artifact',
    'artifact-storage',
    'object',
    's3-object',
    'direct',
    [],
    'purge',
  ),
  resource(
    'application-state',
    'application-state',
    'volume',
    'ebs-volume',
    'direct',
    [],
    'retain',
  ),
  resource(
    'control-state',
    'control-state',
    'volume',
    'ebs-volume',
    'direct',
    [],
    'retain',
  ),
  resource(
    'network-vpc',
    'networking',
    'vpc',
    'ec2-vpc',
    'direct',
    [],
    'purge',
  ),
  resource(
    'network-internet-gateway',
    'networking',
    'internet-gateway',
    'ec2-internet-gateway',
    'direct',
    [],
    'purge',
  ),
  resource(
    'network-internet-gateway-attachment',
    'networking',
    'internet-gateway-attachment',
    'ec2-internet-gateway-attachment',
    'derived',
    ['network-vpc', 'network-internet-gateway'],
    'purge',
  ),
  resource(
    'network-subnet',
    'networking',
    'subnet',
    'ec2-subnet',
    'direct',
    ['network-vpc'],
    'purge',
  ),
  resource(
    'network-route-table',
    'networking',
    'route-table',
    'ec2-route-table',
    'direct',
    ['network-vpc'],
    'purge',
  ),
  resource(
    'network-default-ipv4-route',
    'networking',
    'default-ipv4-route',
    'ec2-ipv4-route',
    'derived',
    ['network-internet-gateway-attachment', 'network-route-table'],
    'purge',
  ),
  resource(
    'network-subnet-route-table-association',
    'networking',
    'subnet-route-table-association',
    'ec2-subnet-route-table-association',
    'derived',
    ['network-subnet', 'network-route-table', 'network-default-ipv4-route'],
    'purge',
  ),
  resource(
    'network-security-group',
    'networking',
    'security-group',
    'ec2-security-group',
    'direct',
    ['network-vpc'],
    'purge',
  ),
  resource(
    'runtime-role',
    'runtime-identity',
    'role',
    'iam-role',
    'direct',
    [],
    'purge',
  ),
  resource(
    'runtime-role-policy',
    'runtime-identity',
    'inline-policy',
    'iam-role-inline-policy',
    'derived',
    ['artifact', 'runtime-role'],
    'purge',
  ),
  resource(
    'runtime-identity',
    'runtime-identity',
    'instance-profile',
    'instance-profile',
    'direct',
    [],
    'purge',
  ),
  resource(
    'runtime-identity-role-association',
    'runtime-identity',
    'instance-profile-role-association',
    'iam-instance-profile-role-association',
    'derived',
    ['runtime-role', 'runtime-role-policy', 'runtime-identity'],
    'purge',
  ),
  resource(
    'substrate',
    'resident-node',
    'node',
    'ec2-instance',
    'direct',
    [
      'artifact',
      'network-subnet',
      'network-default-ipv4-route',
      'network-subnet-route-table-association',
      'network-security-group',
      'runtime-role-policy',
      'runtime-identity',
      'runtime-identity-role-association',
    ],
    'purge',
  ),
  resource(
    'application-state-attachment',
    'application-state',
    'attachment',
    'ebs-volume-attachment',
    'derived',
    ['application-state', 'substrate'],
    'purge',
  ),
  resource(
    'control-state-attachment',
    'control-state',
    'attachment',
    'ebs-volume-attachment',
    'derived',
    ['control-state', 'substrate'],
    'purge',
  ),
];

const EXPECTED_APPLY_ORDER = EXPECTED_RESOURCES.map(
  (definition) => definition.resourceKey,
);

describe('AWS single-node deployment resource graph', () => {
  it('exports the exact content-addressed 18-resource physical graph', () => {
    expect(AWS_SINGLE_NODE_RESOURCE_GRAPH_SCHEMA_VERSION).toBe(2);
    expect(AWS_SINGLE_NODE_RESOURCE_GRAPH_KIND).toBe(
      'awsSingleNodeResourceGraph',
    );
    expect(AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_DOMAIN).toBe(
      'wharfie:aws-single-node-resource-graph:v2',
    );
    expect(AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_PREFIX).toBe('wrg2');
    expect(AWS_SINGLE_NODE_RESOURCE_GRAPH_MAX_RESOURCES).toBe(32);
    expect(AWS_SINGLE_NODE_RESOURCE_GRAPH).toEqual({
      schemaVersion: 2,
      kind: 'awsSingleNodeResourceGraph',
      resourceGraphId: expect.stringMatching(/^wrg2_[A-Za-z0-9_-]{43}$/),
      resources: EXPECTED_RESOURCES,
    });

    const payload = {
      schemaVersion: 2,
      kind: 'awsSingleNodeResourceGraph',
      resources: EXPECTED_RESOURCES,
    };
    const expectedId = createCanonicalJsonSha256Id({
      domain: 'wharfie:aws-single-node-resource-graph:v2',
      prefix: 'wrg2',
      value: payload,
    });
    expect(AWS_SINGLE_NODE_RESOURCE_GRAPH.resourceGraphId).toBe(expectedId);
    expect(getAwsSingleNodeResourceGraphId(payload)).toBe(expectedId);
    expect(
      getAwsSingleNodeResourceGraphId(AWS_SINGLE_NODE_RESOURCE_GRAPH),
    ).toBe(expectedId);
  });

  it('keeps every exported graph value recursively immutable', () => {
    expect(Object.isFrozen(AWS_SINGLE_NODE_RESOURCE_GRAPH)).toBe(true);
    expect(Object.isFrozen(AWS_SINGLE_NODE_RESOURCE_GRAPH.resources)).toBe(
      true,
    );
    expect(Object.isFrozen(AWS_SINGLE_NODE_RESOURCE_GRAPH.resources[0])).toBe(
      true,
    );
    expect(
      Object.isFrozen(AWS_SINGLE_NODE_RESOURCE_GRAPH.resources[0].role),
    ).toBe(true);
    expect(
      Object.isFrozen(AWS_SINGLE_NODE_RESOURCE_GRAPH.resources[15].dependsOn),
    ).toBe(true);
  });

  it('exposes immutable lookup and exact apply/destroy order helpers', () => {
    expect(getAwsSingleNodeResourceApplyOrder()).toEqual(EXPECTED_APPLY_ORDER);
    expect(Object.isFrozen(getAwsSingleNodeResourceApplyOrder())).toBe(true);
    expect(getAwsSingleNodeResourceDestroyOrder()).toEqual(
      [...EXPECTED_APPLY_ORDER].reverse(),
    );
    expect(Object.isFrozen(getAwsSingleNodeResourceDestroyOrder())).toBe(true);
    expect(getAwsSingleNodeResourceDefinition('network-vpc')).toBe(
      AWS_SINGLE_NODE_RESOURCE_GRAPH.resources[3],
    );
    expect(getAwsSingleNodeResourceDefinition('not-present')).toBeNull();
    expect(() => getAwsSingleNodeResourceDefinition('Not Canonical')).toThrow(
      /canonical logical ID/i,
    );
  });

  it('validates a serialized graph into an independent canonical frozen value', () => {
    const serialized = clone(AWS_SINGLE_NODE_RESOURCE_GRAPH);
    const validated = validateAwsSingleNodeResourceGraph(serialized);

    expect(validated).toEqual(AWS_SINGLE_NODE_RESOURCE_GRAPH);
    expect(validated).not.toBe(serialized);
    expect(validated.resources).not.toBe(serialized.resources);
    expect(Object.isFrozen(validated.resources[17].dependsOn)).toBe(true);
    serialized.resources[0].providerType = 'changed';
    expect(validated.resources[0].providerType).toBe('s3-object');
  });

  it('canonicalizes object key order while retaining semantic apply order', () => {
    const reorderedProperties = {
      resources: EXPECTED_RESOURCES.map((definition) => ({
        onDestroy: definition.onDestroy,
        dependsOn: [...definition.dependsOn],
        ownershipMode: definition.ownershipMode,
        providerType: definition.providerType,
        capability: {
          version: definition.capability.version,
          kind: definition.capability.kind,
        },
        role: {
          version: definition.role.version,
          kind: definition.role.kind,
        },
        resourceKey: definition.resourceKey,
      })),
      kind: 'awsSingleNodeResourceGraph',
      schemaVersion: 2,
    };

    expect(
      canonicalizeAwsSingleNodeResourceGraphPayload(reorderedProperties),
    ).toEqual(
      canonicalizeAwsSingleNodeResourceGraphPayload({
        schemaVersion: 2,
        kind: 'awsSingleNodeResourceGraph',
        resources: EXPECTED_RESOURCES,
      }),
    );
    expect(getAwsSingleNodeResourceGraphId(reorderedProperties)).toBe(
      AWS_SINGLE_NODE_RESOURCE_GRAPH.resourceGraphId,
    );

    const permutedResources = clone(AWS_SINGLE_NODE_RESOURCE_GRAPH);
    [permutedResources.resources[0], permutedResources.resources[1]] = [
      permutedResources.resources[1],
      permutedResources.resources[0],
    ];
    const readdressed = withRecomputedIdentity(permutedResources);
    expect(() => validateAwsSingleNodeResourceGraph(readdressed)).toThrow(
      /canonical apply order/i,
    );
    expect(readdressed.resourceGraphId).not.toBe(
      AWS_SINGLE_NODE_RESOURCE_GRAPH.resourceGraphId,
    );
  });

  it.each([
    [
      'unsupported graph field',
      (/** @type {any} */ value) => (value.template = {}),
      /template is not supported/i,
    ],
    [
      'missing graph field',
      (/** @type {any} */ value) => delete value.resources,
      /resources is required/i,
    ],
    [
      'wrong schema version',
      (/** @type {any} */ value) => (value.schemaVersion = 1),
      /schemaVersion must be the integer 2/i,
    ],
    [
      'wrong graph kind',
      (/** @type {any} */ value) => (value.kind = 'resourceGraph'),
      /kind must be 'awsSingleNodeResourceGraph'/i,
    ],
    [
      'old identity prefix',
      (/** @type {any} */ value) =>
        (value.resourceGraphId = value.resourceGraphId.replace(
          /^wrg2_/,
          'wrg1_',
        )),
      /canonical wrg2_/i,
    ],
    [
      'unsupported resource field',
      (/** @type {any} */ value) =>
        (value.resources[0].providerConfiguration = {}),
      /providerConfiguration is not supported/i,
    ],
    [
      'missing resource field',
      (/** @type {any} */ value) => delete value.resources[0].dependsOn,
      /dependsOn is required/i,
    ],
    [
      'unsupported role field',
      (/** @type {any} */ value) => (value.resources[0].role.name = 'object'),
      /role\.name is not supported/i,
    ],
    [
      'missing capability field',
      (/** @type {any} */ value) =>
        delete value.resources[0].capability.version,
      /capability\.version is required/i,
    ],
  ])('rejects %s', (_name, mutate, pattern) => {
    const graph = clone(AWS_SINGLE_NODE_RESOURCE_GRAPH);
    mutate(graph);
    expect(() => validateAwsSingleNodeResourceGraph(graph)).toThrow(pattern);
  });

  it('rejects a validly encoded identity for different graph content', () => {
    const graph = clone(AWS_SINGLE_NODE_RESOURCE_GRAPH);
    graph.resourceGraphId = createCanonicalJsonSha256Id({
      domain: AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_DOMAIN,
      prefix: AWS_SINGLE_NODE_RESOURCE_GRAPH_ID_PREFIX,
      value: { different: true },
    });
    expect(() => validateAwsSingleNodeResourceGraph(graph)).toThrow(
      /resourceGraphId does not match/i,
    );
  });

  it.each([
    [
      'duplicate resource keys',
      (/** @type {any} */ value) =>
        (value.resources[2].resourceKey = 'application-state'),
      /unique resource keys/i,
    ],
    [
      'duplicate roles within a capability',
      (/** @type {any} */ value) => (value.resources[7].role.kind = 'subnet'),
      /unique roles within each capability/i,
    ],
    [
      'an unknown capability',
      (/** @type {any} */ value) =>
        (value.resources[0].capability.kind = 'queue'),
      /capability\.kind is not supported/i,
    ],
    [
      'a noncanonical resource key',
      (/** @type {any} */ value) =>
        (value.resources[0].resourceKey = 'Artifact'),
      /canonical logical ID/i,
    ],
    [
      'a noncanonical role',
      (/** @type {any} */ value) =>
        (value.resources[0].role.kind = 'Object Role'),
      /canonical logical ID/i,
    ],
    [
      'a noncanonical provider type',
      (/** @type {any} */ value) =>
        (value.resources[0].providerType = 'S3::Object'),
      /canonical logical ID/i,
    ],
    [
      'a role version other than one',
      (/** @type {any} */ value) => (value.resources[0].role.version = 2),
      /role\.version must be the integer 1/i,
    ],
    [
      'a capability version other than one',
      (/** @type {any} */ value) => (value.resources[0].capability.version = 2),
      /capability\.version must be the integer 1/i,
    ],
    [
      'an unsupported ownership mode',
      (/** @type {any} */ value) =>
        (value.resources[0].ownershipMode = 'external'),
      /must be 'direct' or 'derived'/i,
    ],
    [
      'an unsupported destroy policy',
      (/** @type {any} */ value) => (value.resources[0].onDestroy = 'delete'),
      /must be 'retain' or 'purge'/i,
    ],
  ])('rejects %s', (_name, mutate, pattern) => {
    const graph = clone(AWS_SINGLE_NODE_RESOURCE_GRAPH);
    mutate(graph);
    expect(() => validateAwsSingleNodeResourceGraph(graph)).toThrow(pattern);
  });

  it('bounds the graph before accepting attacker-controlled resource counts', () => {
    const graph = clone(AWS_SINGLE_NODE_RESOURCE_GRAPH);
    while (
      graph.resources.length <= AWS_SINGLE_NODE_RESOURCE_GRAPH_MAX_RESOURCES
    ) {
      graph.resources.push(clone(graph.resources[0]));
    }
    expect(() => validateAwsSingleNodeResourceGraph(graph)).toThrow(
      /at most 32 resources/i,
    );
  });

  it.each([
    [
      'duplicate dependencies',
      (/** @type {any} */ value) =>
        value.resources[15].dependsOn.push('runtime-identity'),
      /dependsOn must contain unique resource keys/i,
    ],
    [
      'a missing dependency',
      (/** @type {any} */ value) =>
        (value.resources[6].dependsOn[0] = 'missing-vpc'),
      /does not identify a graph resource/i,
    ],
    [
      'a cyclic dependency',
      (/** @type {any} */ value) =>
        value.resources[0].dependsOn.push('substrate'),
      /dependency graph must be acyclic/i,
    ],
    [
      'a forward dependency despite an acyclic graph',
      (/** @type {any} */ value) =>
        value.resources[0].dependsOn.push('application-state'),
      /must reference an earlier resource/i,
    ],
    [
      'dependency keys outside deterministic apply order',
      (/** @type {any} */ value) => value.resources[8].dependsOn.reverse(),
      /dependsOn must follow topological apply order/i,
    ],
    [
      'a missing required dependency',
      (/** @type {any} */ value) => value.resources[15].dependsOn.shift(),
      /dependsOn does not match the finite contract/i,
    ],
  ])('rejects %s', (_name, mutate, pattern) => {
    const graph = clone(AWS_SINGLE_NODE_RESOURCE_GRAPH);
    mutate(graph);
    expect(() => validateAwsSingleNodeResourceGraph(graph)).toThrow(pattern);
  });

  it.each([
    [
      'direct ownership for an attachment relationship',
      (/** @type {any} */ value) =>
        (value.resources[5].ownershipMode = 'direct'),
      /must be 'derived' for role 'internet-gateway-attachment'/i,
    ],
    [
      'derived ownership for a physical resource',
      (/** @type {any} */ value) =>
        (value.resources[3].ownershipMode = 'derived'),
      /must be 'direct' for role 'vpc'/i,
    ],
    [
      'direct ownership for the inline policy relationship',
      (/** @type {any} */ value) =>
        (value.resources[12].ownershipMode = 'direct'),
      /must be 'derived' for role 'inline-policy'/i,
    ],
    [
      'direct ownership for the profile association relationship',
      (/** @type {any} */ value) =>
        (value.resources[14].ownershipMode = 'direct'),
      /must be 'derived' for role 'instance-profile-role-association'/i,
    ],
    [
      'purging a retained volume role',
      (/** @type {any} */ value) => (value.resources[1].onDestroy = 'purge'),
      /must be 'retain' for role 'volume'/i,
    ],
    [
      'retaining a relationship role',
      (/** @type {any} */ value) => (value.resources[16].onDestroy = 'retain'),
      /must be 'purge' for role 'attachment'/i,
    ],
    [
      'a provider type outside the finite role contract',
      (/** @type {any} */ value) => (value.resources[3].providerType = 'vpc'),
      /does not match the finite contract for 'network-vpc'/i,
    ],
  ])('enforces role-level contract: %s', (_name, mutate, pattern) => {
    const graph = clone(AWS_SINGLE_NODE_RESOURCE_GRAPH);
    mutate(graph);
    expect(() => validateAwsSingleNodeResourceGraph(graph)).toThrow(pattern);
  });

  it('rejects missing and unrecognized finite resources', () => {
    const missing = clone(AWS_SINGLE_NODE_RESOURCE_GRAPH);
    missing.resources.pop();
    expect(() => validateAwsSingleNodeResourceGraph(missing)).toThrow(
      /complete 18-resource AWS single-node contract/i,
    );

    const unrecognized = clone(AWS_SINGLE_NODE_RESOURCE_GRAPH);
    unrecognized.resources[10].resourceKey = 'network-firewall';
    unrecognized.resources[15].dependsOn[4] = 'network-firewall';
    expect(() => validateAwsSingleNodeResourceGraph(unrecognized)).toThrow(
      /resourceKey must be 'network-security-group' in canonical apply order/i,
    );
  });
});
